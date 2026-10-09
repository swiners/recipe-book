/* Turn something pasted or fetched into a RecipeDraft.

   Three inputs, tried in this order:
     1. a page's HTML, or an Edge Function's extracted JSON-LD   -> structured, reliable
     2. a bare JSON-LD document                                  -> structured, reliable
     3. plain text (a recipe copied from a message or a book)    -> heuristic, best effort

   Everything here treats its input as hostile: it comes from the open internet or the
   clipboard. It only ever reads values out and coerces them to bounded strings and numbers;
   nothing is evaluated, nothing is rendered as HTML (React escapes text), and every field is
   length-capped so a malicious page cannot build an enormous row.

   allium_free is NEVER set to true by an import. That flag is a safety claim about someone's
   allergy, and "no onion words found in what I parsed" is not the same thing as safe. A
   person turns it on. What the import does is say which allium words it saw. */

import { extractLdJsonBlocks } from "../../supabase/functions/_shared/ldjson.ts";
import { emptyDraft } from "./types.ts";
import type { Ingredient, RecipeDraft } from "./types.ts";
import { safeHttpUrl } from "./url.ts";

export type ImportResult = {
  draft: RecipeDraft;
  /** Things the person should look at before saving. Never empty-string. */
  notes: string[];
  /** Allium words seen in the ingredients or method. Empty means none seen, not none present. */
  alliumWords: string[];
};

const LIMITS = { title: 200, item: 200, step: 2000, notes: 1000, tag: 30, tags: 12, rows: 60 };

/* Same word list as scripts/build-seed.mjs. Garlic is deliberately absent. */
const ALLIUM =
  /\b(onions?|leeks?|shallots?|eschalots?|chives?|scallions?|spring onions?|green onions?|ramps?)\b/gi;

/* ── small coercions ──────────────────────────────────────────────────── */

const asText = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Markup out, entities decoded. For readability; React escapes the result when rendering. */
export function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === "#") {
        const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** "PT1H30M" -> 90. Null when it is not an ISO 8601 duration. */
export function parseIsoDuration(value: unknown): number | null {
  const m = asText(value).trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => (x ? Number(x) : 0));
  const total = d * 1440 + h * 60 + min + Math.round(s / 60);
  return total > 10080 ? null : total;
}

/** "45 min", "1 hour 15 mins", "1h30" -> minutes. */
export function parseLooseDuration(text: string): number | null {
  const h = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const m = text.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (!h && !m) return null;
  return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
}

/* ── ingredient lines ─────────────────────────────────────────────────── */

const QTY_NUMBER = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?\\s*[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])`;
const UNITS =
  "kg|g|mg|ml|l|litres?|liters?|millilitres?|milliliters?|grams?|kilograms?|tsp|teaspoons?|tbsp|tablespoons?|cups?|oz|lbs?|pinch(?:es)?|dash(?:es)?|bunch(?:es)?|handful|cans?|tins?|packets?|sprigs?|slices?|pieces?|sticks?";
const INGREDIENT_LINE = new RegExp(
  `^(${QTY_NUMBER}(?:\\s*(?:-|–|to)\\s*${QTY_NUMBER})?)\\s*(?:(${UNITS})\\b\\.?)?\\s*(.*)$`,
  "i",
);

const CANONICAL_UNIT: Record<string, string> = {
  teaspoon: "tsp", teaspoons: "tsp", tablespoon: "tbsp", tablespoons: "tbsp",
  gram: "g", grams: "g", kilogram: "kg", kilograms: "kg",
  millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  litre: "L", litres: "L", liter: "L", liters: "L", l: "L",
  cups: "cup", tins: "tin", cans: "can", packets: "packet",
};

/** "1 1/2 cups plain flour" -> { qty: "1 1/2", unit: "cup", item: "plain flour" }. */
export function parseIngredientLine(raw: string): Ingredient | null {
  const line = cap(raw.replace(/^[\s\-•*·▢☐◦▪•]+/, "").replace(/\s+/g, " ").trim(), LIMITS.item);
  if (!line) return null;

  const m = line.match(INGREDIENT_LINE);
  if (!m || !m[3].trim()) return { qty: "", unit: "", item: line };

  const unit = m[2] ? (CANONICAL_UNIT[m[2].toLowerCase()] ?? m[2].toLowerCase()) : "";
  return { qty: m[1].replace(/(\d),(\d)/, "$1.$2").trim(), unit, item: m[3].trim() };
}

/** Does this line start with a quantity? Used to tell ingredients from method in loose text. */
const startsWithQuantity = (line: string): boolean => /^[\s\-•*·▢☐]*[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(line);

/* ── JSON-LD ──────────────────────────────────────────────────────────── */

type Json = Record<string, unknown>;

const isRecipeType = (t: unknown): boolean =>
  (typeof t === "string" && t.toLowerCase() === "recipe") ||
  (Array.isArray(t) && t.some((x) => typeof x === "string" && x.toLowerCase() === "recipe"));

/** Depth-limited search: the Recipe node can sit in an array, in @graph, or nested. */
function findRecipeNode(value: unknown, depth = 0): Json | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findRecipeNode(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const obj = value as Json;
  if (isRecipeType(obj["@type"])) return obj;
  return findRecipeNode(obj["@graph"], depth + 1);
}

const toList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** recipeInstructions is a string, a list of strings, a list of HowToStep, or HowToSections of those. */
function collectSteps(value: unknown, out: string[], depth = 0): void {
  if (depth > 4) return;
  for (const v of toList(value)) {
    // Checked per element, not once on entry: a single page can hand over thousands.
    if (out.length >= LIMITS.rows) return;
    if (typeof v === "string") {
      // One string with line breaks is several steps, not one.
      for (const part of v.split(/\r?\n|<br\s*\/?>/i)) {
        if (out.length >= LIMITS.rows) return;
        const t = cleanText(part).replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, "");
        if (t) out.push(cap(t, LIMITS.step));
      }
    } else if (v && typeof v === "object") {
      const o = v as Json;
      if (o.itemListElement !== undefined) collectSteps(o.itemListElement, out, depth + 1);
      else collectSteps(asText(o.text) || asText(o.name), out, depth + 1);
    }
  }
}

const firstInteger = (v: unknown): number | null => {
  for (const x of toList(v)) {
    const m = asText(x).match(/\d+/);
    if (m) {
      const n = Number(m[0]);
      if (n > 0 && n <= 1000) return n;
    }
  }
  return null;
};

export function recipeFromJsonLd(blocks: string[]): ImportResult | null {
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue; // Pages routinely ship malformed blocks; try the next one.
    }
    const node = findRecipeNode(parsed);
    if (node) return fromRecipeNode(node);
  }
  return null;
}

function fromRecipeNode(node: Json): ImportResult {
  const draft = emptyDraft();
  const notes: string[] = [];

  draft.title = cap(cleanText(asText(node.name)), LIMITS.title);
  draft.servings = firstInteger(node.recipeYield);

  draft.prep_minutes = parseIsoDuration(node.prepTime);
  draft.cook_minutes = parseIsoDuration(node.cookTime);
  if (draft.prep_minutes === null && draft.cook_minutes === null) {
    const total = parseIsoDuration(node.totalTime);
    if (total !== null) {
      draft.cook_minutes = total;
      notes.push("The page only gave a total time, so it is in Cook. Split it into prep and cook if you want.");
    }
  }

  const rawIngredients = toList(node.recipeIngredient ?? node.ingredients);
  draft.ingredients = rawIngredients
    .slice(0, LIMITS.rows)
    .map((i) => parseIngredientLine(cleanText(asText(i))))
    .filter((i): i is Ingredient => i !== null);

  const steps: string[] = [];
  collectSteps(node.recipeInstructions, steps);
  draft.steps = steps;

  const tags = new Set<string>();
  for (const source of [node.keywords, node.recipeCategory, node.recipeCuisine]) {
    for (const v of toList(source)) {
      for (const part of asText(v).split(",")) {
        const t = cleanText(part).toLowerCase();
        if (t && t.length <= LIMITS.tag) tags.add(t);
      }
    }
  }
  draft.tags = [...tags].slice(0, LIMITS.tags);

  const urlField = typeof node.url === "string" ? node.url : typeof node.mainEntityOfPage === "string" ? node.mainEntityOfPage : "";
  draft.source_url = safeHttpUrl(urlField);

  const description = cleanText(asText(node.description));
  if (description) draft.notes = cap(description, LIMITS.notes);

  return finish(draft, notes);
}

/* ── plain text ───────────────────────────────────────────────────────── */

const H_INGREDIENTS = /^ingredients?\s*:?$/i;
const H_METHOD = /^(?:method|directions?|instructions?|steps?|preparation|to make)\s*:?$/i;
const H_NOTES = /^(?:notes?|tips?)\s*:?$/i;

export function recipeFromText(text: string): ImportResult | null {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 400);
  if (lines.length === 0) return null;

  const draft = emptyDraft();
  const notes: string[] = [];
  const ingredientLines: string[] = [];
  const stepLines: string[] = [];
  const noteLines: string[] = [];
  const loose: string[] = [];

  let section: "none" | "ingredients" | "method" | "notes" = "none";
  let sawHeader = false;

  lines.forEach((line, i) => {
    if (i === 0 && !H_INGREDIENTS.test(line) && !H_METHOD.test(line)) {
      draft.title = cap(line.replace(/^#+\s*/, ""), LIMITS.title);
      return;
    }
    if (H_INGREDIENTS.test(line)) { section = "ingredients"; sawHeader = true; return; }
    if (H_METHOD.test(line)) { section = "method"; sawHeader = true; return; }
    if (H_NOTES.test(line)) { section = "notes"; sawHeader = true; return; }

    const serves = line.match(/^(?:serves?|servings?|makes|yield)\s*:?\s*(\d+)/i);
    if (serves) { draft.servings = Number(serves[1]); return; }
    const prep = line.match(/^prep(?:aration)?(?:\s*time)?\s*:?\s*(.+)$/i);
    if (prep && parseLooseDuration(prep[1]) !== null) { draft.prep_minutes = parseLooseDuration(prep[1]); return; }
    const cook = line.match(/^cook(?:ing)?(?:\s*time)?\s*:?\s*(.+)$/i);
    if (cook && parseLooseDuration(cook[1]) !== null) { draft.cook_minutes = parseLooseDuration(cook[1]); return; }

    if (section === "ingredients") ingredientLines.push(line);
    else if (section === "method") stepLines.push(line);
    else if (section === "notes") noteLines.push(line);
    else loose.push(line);
  });

  if (!sawHeader) {
    /* No headings to go on. Lines that start with a quantity are ingredients; the rest
       are method. It is a guess, so say so and let the person fix it in the form. */
    for (const line of loose) (startsWithQuantity(line) && line.length < 90 ? ingredientLines : stepLines).push(line);
    notes.push("There were no Ingredients / Method headings, so lines were sorted by guesswork. Check both lists.");
  }

  draft.ingredients = ingredientLines
    .slice(0, LIMITS.rows)
    .map(parseIngredientLine)
    .filter((i): i is Ingredient => i !== null);
  draft.steps = stepLines
    .slice(0, LIMITS.rows)
    .map((s) => cap(s.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, ""), LIMITS.step));
  if (noteLines.length) draft.notes = cap(noteLines.join("\n"), LIMITS.notes);

  if (draft.ingredients.length === 0 && draft.steps.length === 0) return null;
  return finish(draft, notes);
}

/* ── entry point ──────────────────────────────────────────────────────── */

/** Why an import produced nothing, in words a person can act on. */
export type ImportFailure = { ok: false; reason: string };
export type ImportOutcome = ({ ok: true } & ImportResult) | ImportFailure;

export function importFromPaste(input: string): ImportOutcome {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "Nothing to import yet. Paste a recipe first." };

  const looksLikeHtml = /<\s*(?:script|html|head|body|div|!doctype)/i.test(text);
  if (looksLikeHtml) {
    const blocks = extractLdJsonBlocks(text);
    const result = recipeFromJsonLd(blocks);
    return result
      ? { ok: true, ...result }
      : { ok: false, reason: "That page source has no structured recipe in it. Copy the recipe text itself instead." };
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    const result = recipeFromJsonLd([text]);
    if (result) return { ok: true, ...result };
    // Fell through: it was braces but not a recipe. Treat it as text rather than refusing.
  }

  const result = recipeFromText(text);
  return result
    ? { ok: true, ...result }
    : { ok: false, reason: "Could not find ingredients or a method in that. Try pasting the recipe text with its headings." };
}

/** Shared tail: allium scan, and the notes every import carries. */
function finish(draft: RecipeDraft, notes: string[]): ImportResult {
  if (draft.ingredients.length === 0) draft.ingredients = emptyDraft().ingredients;
  if (draft.steps.length === 0) draft.steps = emptyDraft().steps;

  const haystack = [...draft.ingredients.map((i) => i.item), ...draft.steps].join("\n");
  const found = [...new Set([...haystack.matchAll(ALLIUM)].map((m) => m[0].toLowerCase()))];

  return { draft, notes, alliumWords: found };
}
