import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildShoppingList, formatNumber, itemKey, normaliseUnit, parseNumber, scaleFactor, scaleQty,
} from "../src/lib/quantity.ts";

test("parseNumber reads the forms recipes actually use", () => {
  assert.equal(parseNumber("2"), 2);
  assert.equal(parseNumber("1.5"), 1.5);
  assert.equal(parseNumber("1,5"), 1.5);
  assert.equal(parseNumber("1/2"), 0.5);
  assert.equal(parseNumber("1 1/2"), 1.5);
  assert.equal(parseNumber("½"), 0.5);
  assert.equal(parseNumber("1½"), 1.5);
  assert.equal(parseNumber("2 ¼"), 2.25);
});

test("parseNumber refuses anything that is not clearly a number", () => {
  for (const s of ["", "pinch", "a few", "1/0", "2-3", "to taste", "1 1/0"]) {
    assert.equal(parseNumber(s), null, `"${s}"`);
  }
});

test("formatNumber prints kitchen fractions, not floating-point noise", () => {
  assert.equal(formatNumber(0.5), "½");
  assert.equal(formatNumber(1.5), "1½");
  assert.equal(formatNumber(2.25), "2¼");
  assert.equal(formatNumber(1 / 3), "⅓");
  assert.equal(formatNumber(0.1 + 0.2), "0.3", "float error (0.30000000000000004) does not leak out");
  assert.equal(formatNumber(0.5 + 1e-12), "½");
  assert.equal(formatNumber(2), "2");
  assert.equal(formatNumber(2.999), "3");
  assert.equal(formatNumber(37.5), "38");
  assert.equal(formatNumber(150), "150");
  assert.equal(formatNumber(0.01), "0.1", "never prints a zero for something the recipe needs");
});

test("scaleQty scales numbers and ranges, and leaves text alone", () => {
  assert.equal(scaleQty("400", 2), "800");
  assert.equal(scaleQty("1", 0.5), "½");
  assert.equal(scaleQty("1.5", 2), "3");
  assert.equal(scaleQty("1/2", 3), "1½");
  assert.equal(scaleQty("2-3", 2), "4–6");
  assert.equal(scaleQty("2 to 3", 2), "4–6");
  assert.equal(scaleQty("pinch", 4), "pinch");
  assert.equal(scaleQty("", 4), "");
});

test("scaleQty returns the original text at factor 1, and for nonsense factors", () => {
  assert.equal(scaleQty("1.5", 1), "1.5", "what you typed is what you see");
  assert.equal(scaleQty("2", 0), "2");
  assert.equal(scaleQty("2", -1), "2");
  assert.equal(scaleQty("2", NaN), "2");
  assert.equal(scaleQty("2", Infinity), "2");
});

test("scaleFactor falls back to 1 when the recipe has no servings", () => {
  assert.equal(scaleFactor(4, 2), 2);
  assert.equal(scaleFactor(4, null), 1);
  assert.equal(scaleFactor(4, 0), 1);
});

test("itemKey ignores prep notes and plurals so the same thing merges", () => {
  assert.equal(itemKey("garlic cloves, thinly sliced"), itemKey("garlic cloves, finely chopped (marinade)"));
  assert.equal(itemKey("fennel bulb, finely diced (about 250 g)"), itemKey("fennel bulbs, cut into wedges"));
  assert.equal(itemKey("tomatoes"), itemKey("tomato"));
  assert.notEqual(itemKey("red cabbage"), itemKey("cabbage"));
  assert.equal(itemKey("glass"), "glass", "double-s words are not plurals");
});

test("normaliseUnit turns size words into counts and spells units one way", () => {
  assert.equal(normaliseUnit("small"), "");
  assert.equal(normaliseUnit("Large"), "");
  assert.equal(normaliseUnit("teaspoons"), "tsp");
  assert.equal(normaliseUnit("Litres"), "l");
});

test("buildShoppingList adds like with like and keeps unlike apart", () => {
  const rows = buildShoppingList([
    { qty: "400", unit: "g", item: "chicken thigh fillets, cut into pieces" },
    { qty: "800", unit: "g", item: "chicken thigh fillets" },
    { qty: "1", unit: "large", item: "fennel bulb, diced" },
    { qty: "2", unit: "", item: "fennel bulbs, cut into wedges" },
    { qty: "1", unit: "tsp", item: "salt" },
    { qty: "", unit: "", item: "salt" },
    { qty: "pinch", unit: "", item: "salt" },
    { qty: "2", unit: "tbsp", item: "olive oil" },
    { qty: "30", unit: "ml", item: "olive oil" },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r.amounts]));

  assert.deepEqual(by["chicken thigh fillet"], ["1.2 kg"], "g adds up and prints as kg");
  assert.deepEqual(by["fennel bulb"], ["3"], "size words are counts");
  assert.deepEqual(by["salt"].sort(), ["1 tsp", "pinch"].sort(), "no-quantity salt adds nothing");
  assert.deepEqual(by["olive oil"].sort(), ["2 tbsp", "30 ml"].sort(), "tbsp and ml are not converted");
});

test("buildShoppingList never loses a line to a blank or odd item", () => {
  const rows = buildShoppingList([
    { qty: "1", unit: "", item: "   " },
    { qty: "1", unit: "", item: "lemon" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, "lemon");
});

test("a range is bought at its upper end", () => {
  const [row] = buildShoppingList([{ qty: "2-3", unit: "", item: "limes" }]);
  assert.deepEqual(row.amounts, ["3"]);
});

test("water is not a shopping item, but water chestnuts are", () => {
  const rows = buildShoppingList([
    { qty: "1.2", unit: "L", item: "water" },
    { qty: "250", unit: "ml", item: "boiling water" },
    { qty: "1", unit: "tin", item: "water chestnuts" },
  ]);
  assert.deepEqual(rows.map((r) => r.item), ["water chestnuts"]);
});

test("every seed recipe: the merged list reads as things you can buy", () => {
  // Regression for real defects found by reading the output: an item written
  // "bone-in, skin-on chicken thighs" was keyed on the adjective before the comma, and a
  // size word left in the item ("small garlic clove") stopped it merging with other cloves.
  const seed = JSON.parse(readFileSync(new URL("../seed/recipes.json", import.meta.url), "utf8"));
  const lines = seed.flatMap((r: { ingredients: { qty: string; unit: string; item: string }[] }) => r.ingredients);
  const rows = buildShoppingList(lines);
  const by = Object.fromEntries(rows.map((r) => [r.key, r.amounts]));

  assert.ok(!("bone-in" in by), "no row keyed on an adjective");
  // 8 in the traybake + 8 in the tagine: two recipes naming the same cut merge into one row.
  assert.deepEqual(by["chicken thigh"], ["16"], "bone-in thighs are listed as chicken thighs, and merge across recipes");
  assert.ok(!("small garlic clove" in by), "size words do not live in the item name");
  assert.ok(!("water" in by));

  // A one-word row that is an adjective or a prep word is the symptom to catch next time.
  const suspicious = rows.filter((r) => /^(?:small|large|medium|fresh|dried|ground|bone-in|skin-on|boneless|thinly|finely|roughly)$/i.test(r.item));
  assert.deepEqual(suspicious, [], "no row is only a descriptor");
});

test("a real week: three seed recipes merge into a sensible list", () => {
  const seed = JSON.parse(readFileSync(new URL("../seed/recipes.json", import.meta.url), "utf8"));
  const pick = (t: string) => seed.find((r: { title: string }) => r.title.startsWith(t));
  const week = ["Lemon-oregano chicken and fennel", "Fennel, carrot", "Onion-free shakshuka"].map(pick);
  const lines = week.flatMap((r: { ingredients: { qty: string; unit: string; item: string }[] }) => r.ingredients);
  const rows = buildShoppingList(lines);

  assert.ok(rows.length < lines.length, "merging actually reduced the number of rows");
  const fennel = rows.find((r) => r.key === "fennel bulb");
  assert.ok(fennel, "fennel is on the list once");
  // 2 bulbs (traybake) + 1 large (ragu) + 1 small (shakshuka) = 4
  assert.deepEqual(fennel!.amounts, ["4"]);
  assert.equal(rows.filter((r) => r.key === "fennel bulb").length, 1);
});
