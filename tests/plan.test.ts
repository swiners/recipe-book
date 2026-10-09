import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampServings, MAX_PLAN, MAX_SERVINGS, parsePlan, parseTicked, planLines, plannedRecipes, shoppingList, shoppingListText,
} from "../src/lib/plan.ts";
import type { Recipe } from "../src/lib/types.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recipe = (n: number, over: Partial<Recipe> = {}): Recipe => ({
  id: id(n), user_id: "u", title: `R${n}`, servings: 2, prep_minutes: null, cook_minutes: null,
  ingredients: [{ qty: "200", unit: "g", item: "flour" }, { qty: "1", unit: "", item: "egg" }],
  steps: [], tags: [], allium_free: true, source_url: null, notes: null, rating: null, last_cooked: null,
  photo_path: null, created_at: "", updated_at: "", ...over,
});

test("parsePlan: round-trips a well-formed plan", () => {
  const raw = JSON.stringify([{ id: id(1), servings: 4 }, { id: id(2), servings: null }]);
  assert.deepEqual(parsePlan(raw), [{ id: id(1), servings: 4 }, { id: id(2), servings: null }]);
});

test("parsePlan: storage is untrusted, so nothing malformed gets through or throws", () => {
  assert.deepEqual(parsePlan(null), []);
  assert.deepEqual(parsePlan(""), []);
  assert.deepEqual(parsePlan("{not json"), []);
  assert.deepEqual(parsePlan('{"id":"x"}'), [], "an object is not an array");
  assert.deepEqual(parsePlan('"a string"'), []);
  assert.deepEqual(parsePlan("null"), []);
  assert.deepEqual(parsePlan(JSON.stringify([null, 1, "x", [], { id: 5 }, { id: "not-a-uuid" }, { id: "'; drop table recipes;--" }])), []);
  assert.deepEqual(parsePlan(JSON.stringify([{ id: `${id(1)}<script>` }])), [], "a UUID with junk appended is not a UUID");
});

test("parsePlan: bad servings become null rather than dropping the recipe", () => {
  for (const bad of [0, -3, 1.5, 101, 1e9, "4", NaN, null, {}, [4]]) {
    const out = parsePlan(JSON.stringify([{ id: id(1), servings: bad }]));
    assert.deepEqual(out, [{ id: id(1), servings: null }], String(bad));
  }
  assert.equal(parsePlan(JSON.stringify([{ id: id(1), servings: MAX_SERVINGS }]))[0].servings, MAX_SERVINGS);
  assert.equal(parsePlan(JSON.stringify([{ id: id(1), servings: 1 }]))[0].servings, 1);
});

test("parsePlan: duplicates collapse and the list is capped", () => {
  assert.equal(parsePlan(JSON.stringify([{ id: id(1), servings: 2 }, { id: id(1), servings: 9 }])).length, 1);
  const many = Array.from({ length: 500 }, (_, i) => ({ id: id(i + 1), servings: 2 }));
  assert.equal(parsePlan(JSON.stringify(many)).length, MAX_PLAN);
});

test("parseTicked: only short strings survive, capped in count", () => {
  assert.deepEqual(parseTicked('["egg","flour"]'), ["egg", "flour"]);
  assert.deepEqual(parseTicked('[1,null,{"a":1},"ok"]'), ["ok"]);
  assert.deepEqual(parseTicked(`["${"x".repeat(500)}"]`), []);
  assert.equal(parseTicked(JSON.stringify(Array.from({ length: 2000 }, (_, i) => `k${i}`))).length, 500);
  assert.deepEqual(parseTicked("garbage"), []);
  assert.deepEqual(parseTicked(null), []);
});

test("clampServings stays within 1..MAX and whole", () => {
  assert.equal(clampServings(0), 1);
  assert.equal(clampServings(-5), 1);
  assert.equal(clampServings(2.6), 3);
  assert.equal(clampServings(9999), MAX_SERVINGS);
});

test("plannedRecipes drops deleted recipes and keeps plan order", () => {
  const recipes = [recipe(1), recipe(2), recipe(3)];
  const out = plannedRecipes([{ id: id(3), servings: 6 }, { id: id(99), servings: 2 }, { id: id(1), servings: null }], recipes);
  assert.deepEqual(out.map((p) => [p.recipe.title, p.servings]), [["R3", 6], ["R1", 2]], "null servings falls back to the recipe's own");
});

test("planLines scales each recipe by its own planned servings", () => {
  const planned = [{ recipe: recipe(1, { servings: 2 }), servings: 6 }, { recipe: recipe(2, { servings: 4 }), servings: 4 }];
  const lines = planLines(planned);
  assert.deepEqual(
    lines.map((l) => [l.qty, l.unit, l.item].filter(Boolean).join(" ")),
    ["600 g flour", "3 egg", "200 g flour", "1 egg"],
  );
});

test("a recipe with no servings is never scaled, and blank ingredients are skipped", () => {
  const r = recipe(1, { servings: null, ingredients: [{ qty: "2", unit: "", item: "eggs" }, { qty: "", unit: "", item: "  " }] });
  const lines = planLines([{ recipe: r, servings: 8 }]);
  assert.deepEqual(lines, [{ qty: "2", unit: "", item: "eggs" }]);
});

test("shoppingList merges the plan, and the text export leaves out ticked items", () => {
  const planned = [{ recipe: recipe(1), servings: 2 }, { recipe: recipe(2), servings: 4 }];
  const rows = shoppingList(planned);
  const by = Object.fromEntries(rows.map((r) => [r.key, r.amounts]));
  assert.deepEqual(by["flour"], ["600 g"], "200 g + 400 g");
  assert.deepEqual(by["egg"], ["3"]);

  assert.equal(shoppingListText(rows, new Set()), "- 600 g flour\n- 3 egg");
  assert.equal(shoppingListText(rows, new Set(["egg"])), "- 600 g flour");
  assert.equal(shoppingListText(rows, new Set(["egg", "flour"])), "");
});
