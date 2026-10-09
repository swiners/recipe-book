import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchSpecies, SPECIES, speciesCounts } from "../src/lib/catch.ts";
import type { Recipe } from "../src/lib/types.ts";

const seed = JSON.parse(readFileSync(new URL("../seed/recipes.json", import.meta.url), "utf8"));
const recipes: Recipe[] = seed.map((r: object, i: number) => ({
  ...r, id: `id-${i}`, user_id: "u", photo_path: null, created_at: "", updated_at: "",
}));
const species = (name: string) => SPECIES.find((s) => s.name === name)!;
const titles = (name: string, tier: "made" | "also") =>
  matchSpecies(recipes, species(name)).filter((m) => m.tier === tier).map((m) => m.recipe.title);

test("made-for means the species is in the title", () => {
  assert.deepEqual(titles("Flathead", "made"), ["Pan-fried flathead with lemon-caper butter and shaved fennel"]);
  assert.deepEqual(titles("Prawns", "made"), ["Chilli garlic prawns with white beans"]);
  assert.deepEqual(titles("Squid", "made"), ["Garlic and chilli calamari"], "calamari in the title counts for squid");
  assert.deepEqual(titles("Whiting", "made"), ["Crumbed whiting with lemon and fennel slaw"]);
  assert.deepEqual(titles("Mulloway", "made"), ["Crispy-skin mulloway with lemon-herb potatoes"]);
  assert.deepEqual(titles("Australian salmon", "made"), ["Australian salmon fishcakes with dill yoghurt"]);
});

test("also-works means named elsewhere, such as a swap in the ingredients", () => {
  // The tacos list flathead as one option; the crumbed whiting names it as a swap in its notes.
  assert.deepEqual(titles("Flathead", "also").sort(), [
    "Crumbed whiting with lemon and fennel slaw",
    "Fish tacos with quick-pickled fennel slaw",
  ]);
  assert.ok(titles("Whiting", "also").length >= 2, "the flathead recipe and the tacos both offer whiting as an option");
});

test("farmed salmon and Australian salmon are different fish and do not cross-match", () => {
  const salmonAll = matchSpecies(recipes, species("Salmon")).map((m) => m.recipe.title);
  const ausAll = matchSpecies(recipes, species("Australian salmon")).map((m) => m.recipe.title);

  assert.ok(salmonAll.includes("Miso-glazed salmon with sesame greens and rice"));
  assert.ok(!salmonAll.includes("Fish tacos with quick-pickled fennel slaw"), "tacos only list Australian salmon");
  assert.ok(ausAll.includes("Fish tacos with quick-pickled fennel slaw"));
  assert.ok(!ausAll.includes("Miso-glazed salmon with sesame greens and rice"));
  // "Aussie salmon" is the same fish in the bream recipe's swap list.
  assert.ok(ausAll.includes("Foil-baked bream with fennel, tomato and olives"));
});

test("matching is whole-word: 'bream' does not match inside another word", () => {
  const fake: Recipe = { ...recipes[0], title: "Breaming rig", ingredients: [{ qty: "", unit: "", item: "seabreams" }], notes: null, tags: [] };
  assert.deepEqual(matchSpecies([fake], species("Bream")), []);
});

test("case does not matter", () => {
  const fake: Recipe = { ...recipes[0], title: "FLATHEAD NIGHT", ingredients: [], notes: null, tags: [] };
  assert.equal(matchSpecies([fake], species("Flathead"))[0].tier, "made");
});

test("made-for sorts before also-works, then by rating", () => {
  const mk = (title: string, rating: number | null, notes: string): Recipe =>
    ({ ...recipes[0], id: title, title, rating, ingredients: [], notes, tags: [] });
  const out = matchSpecies(
    [mk("A swap", 5, "works with flathead"), mk("Flathead pie", 2, ""), mk("Flathead curry", 4, "")],
    species("Flathead"),
  ).map((m) => m.recipe.title);
  assert.deepEqual(out, ["Flathead curry", "Flathead pie", "A swap"]);
});

test("every species gets a count, including those with no recipes, so the gap is visible", () => {
  const counts = Object.fromEntries(speciesCounts(recipes).map((c) => [c.species.name, c.count]));
  assert.ok(counts["Mulloway"] >= 1);
  assert.ok(counts["Flathead"] >= 2);
  assert.equal(Object.keys(counts).length, SPECIES.length);

  // An empty book is the case where every chip should say 0 rather than disappear.
  const empty = speciesCounts([]);
  assert.equal(empty.length, SPECIES.length);
  assert.ok(empty.every((c) => c.count === 0));
});

test("a recipe with no matching text matches nothing, and an empty book matches nothing", () => {
  assert.deepEqual(matchSpecies([], species("Flathead")), []);
  const other = recipes.find((r) => r.title.startsWith("Red lentil"))!;
  for (const s of SPECIES) assert.deepEqual(matchSpecies([other], s), [], s.name);
});
