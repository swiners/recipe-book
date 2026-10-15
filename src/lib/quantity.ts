/* Quantity maths for scaling a recipe and merging shopping lists.

   Quantities are free text ("1", "1/2", "1½", "2-3", "pinch") because that is what people
   type and what imported recipes contain. Anything that is not clearly a number is passed
   through untouched: a wrong guess ("pinch" scaled to "2.4") is worse than leaving it.

   Plain functions with `.ts` import specifiers so the unit tests can load this file
   directly under Node, without a bundler. */

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 1 / 4, "½": 1 / 2, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3,
  "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8,
};

/* Fractions we are willing to print, nearest first wins. Eighths are as fine as a home
   cook measures; anything between them falls through to a rounded decimal. */
const PRINTABLE_FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"],
  [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"],
];

const FRACTION_CLASS = Object.keys(UNICODE_FRACTIONS).join("");

/** A single number: "2", "1.5", "1/2", "1 1/2", "1½", "½". Null for anything else. */
export function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/(\d),(\d)/, "$1.$2");
  if (t === "") return null;

  let m = t.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);

  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);

  m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);

  m = t.match(new RegExp(`^(\\d+)?\\s*([${FRACTION_CLASS}])$`));
  if (m) return (m[1] ? Number(m[1]) : 0) + UNICODE_FRACTIONS[m[2]];

  return null;
}

/** "2-3", "2 to 3", "2–3" -> [2, 3]. Null if it is not a range of two numbers. */
function parseRange(raw: string): [number, number] | null {
  // A slash is a fraction, not a range separator, so it is deliberately not listed here.
  const parts = raw.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  if (parts.length !== 2) return null;
  const a = parseNumber(parts[0]);
  const b = parseNumber(parts[1]);
  return a === null || b === null ? null : [a, b];
}

/** Print a number the way a recipe would: 0.5 -> "½", 2.25 -> "2¼", 150 -> "150". */
export function formatNumber(n: number): string {
  if (n <= 0) return "0";
  // A recipe that needs some of something never needs zero of it. Checked before the
  // whole/fraction split below, which would round a tiny value down to "0".
  if (n < 0.06) return "0.1";
  if (n >= 20) return String(Math.round(n));

  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;

  if (rest < 0.03) return String(whole);
  if (rest > 0.97) return String(whole + 1);

  const near = PRINTABLE_FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.03);
  if (near) return `${whole > 0 ? whole : ""}${near[1]}`;

  // Not a friendly fraction. One decimal place reads fine at kitchen scale.
  return String(Math.round(n * 10) / 10);
}

/** Scale a free-text quantity. Non-numeric text, and a factor of 1, return the input as is. */
export function scaleQty(qty: string, factor: number): string {
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0) return qty;

  const single = parseNumber(qty);
  if (single !== null) return formatNumber(single * factor);

  const range = parseRange(qty);
  if (range) return `${formatNumber(range[0] * factor)}–${formatNumber(range[1] * factor)}`;

  return qty;
}

/** Target servings over the recipe's own. 1 when the recipe does not say how many it serves. */
export function scaleFactor(target: number, base: number | null): number {
  return base && base > 0 && target > 0 ? target / base : 1;
}

/* ── shopping list ─────────────────────────────────────────────────────── */

export type Line = { qty: string; unit: string; item: string };
export type ShoppingRow = {
  /** Stable key for ticking items off. */
  key: string;
  item: string;
  /** "500 g", "2", "1 pinch". Several when units cannot be added together. */
  amounts: string[];
};

/* Size words are written in the unit slot ("1 small fennel bulb") but they are counts.
   Treating them as units would give three rows for one vegetable. */
const SIZE_UNITS = new Set(["small", "medium", "large", "big"]);

const UNIT_ALIASES: Record<string, string> = {
  teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsps: "tbsp",
  gram: "g", grams: "g", gm: "g",
  kilogram: "kg", kilograms: "kg",
  millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  litre: "l", litres: "l", liter: "l", liters: "l",
  cups: "cup", tins: "tin", cans: "can", pinches: "pinch",
};

export function normaliseUnit(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  if (SIZE_UNITS.has(u)) return "";
  return UNIT_ALIASES[u] ?? u;
}

function singular(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("oes")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** "garlic cloves, thinly sliced (marinade)" -> "garlic clove". The part people vary on is
    the prep note after the comma, not the thing being bought. */
export function itemKey(item: string): string {
  const base = baseName(item).toLowerCase();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
}

function baseName(item: string): string {
  return item.replace(/\([^)]*\)/g, "").split(",")[0].replace(/\s+/g, " ").trim();
}

/** A number for adding up. A range buys at its upper end, so the shop is never short. */
function summable(qty: string): number | null {
  const single = parseNumber(qty);
  if (single !== null) return single;
  const range = parseRange(qty);
  return range ? range[1] : null;
}

/* Weight and volume are added in their small unit and printed in the big one, so 600 g
   and 1.2 kg become "1.8 kg" rather than two rows. */
function toBase(n: number, unit: string): [number, string] {
  if (unit === "kg") return [n * 1000, "g"];
  if (unit === "l") return [n * 1000, "ml"];
  return [n, unit];
}

function print(n: number, unit: string): string {
  if (unit === "g" && n >= 1000) return `${formatNumber(n / 1000)} kg`;
  if (unit === "ml" && n >= 1000) return `${formatNumber(n / 1000)} L`;
  return [formatNumber(n), unit].filter(Boolean).join(" ");
}

/* Things a recipe lists that nobody shops for. Matched on the whole key so "water chestnut"
   is still a thing you buy. */
const NOT_SHOPPING = new Set(["water", "cold water", "hot water", "boiling water", "warm water", "ice", "ice water"]);

/** Merge ingredient lines (already scaled by the caller) into one row per thing to buy. */
export function buildShoppingList(lines: Line[]): ShoppingRow[] {
  const rows = new Map<string, { item: string; totals: Map<string, number>; text: Set<string> }>();

  for (const line of lines) {
    const key = itemKey(line.item);
    if (!key || NOT_SHOPPING.has(key)) continue;
    let row = rows.get(key);
    if (!row) {
      row = { item: baseName(line.item), totals: new Map(), text: new Set() };
      rows.set(key, row);
    }

    const n = summable(line.qty);
    const unit = normaliseUnit(line.unit);
    if (n === null) {
      // "pinch", "a few", or no quantity at all. Kept as text, de-duplicated.
      const t = [line.qty.trim(), line.unit.trim()].filter(Boolean).join(" ");
      if (t) row.text.add(t);
    } else {
      const [base, baseUnit] = toBase(n, unit);
      row.totals.set(baseUnit, (row.totals.get(baseUnit) ?? 0) + base);
    }
  }

  return [...rows.entries()].map(([key, r]) => ({
    key,
    item: r.item,
    amounts: [...[...r.totals].map(([unit, n]) => print(n, unit)), ...r.text],
  }));
}
