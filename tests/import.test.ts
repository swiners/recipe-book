import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText, importFromPaste, parseIngredientLine, parseIsoDuration, parseLooseDuration, recipeFromJsonLd,
} from "../src/lib/importRecipe.ts";
import { extractLdJsonBlocks } from "../supabase/functions/_shared/ldjson.ts";
import { safeHttpUrl } from "../src/lib/url.ts";

/* A trimmed-down version of what a real recipe site ships: Recipe inside @graph, HowTo
   sections, ISO durations, HTML entities in the text. Written by hand, not copied from
   any site. */
const GRAPH_PAGE = `<!doctype html><html><head><title>x</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"WebSite","name":"Some Site"},
 {"@type":["Recipe","NewsArticle"],"name":"Garlic &amp; Chilli Prawns","url":"https://example.com/prawns",
  "recipeYield":["4","4 servings"],"prepTime":"PT10M","cookTime":"PT1H15M",
  "description":"<p>Quick &amp; easy.</p>",
  "keywords":"Seafood, quick, Weeknight","recipeCategory":"Dinner","recipeCuisine":["Australian"],
  "recipeIngredient":["400 g raw prawns","4 garlic cloves, sliced","1/2 tsp chilli flakes","1 large onion, diced","salt"],
  "recipeInstructions":[
    {"@type":"HowToSection","name":"Prep","itemListElement":[{"@type":"HowToStep","text":"Peel the prawns."}]},
    {"@type":"HowToStep","text":"Cook&nbsp;them <b>fast</b>."},
    "1. Serve."
  ]}]}</script>
<script>var tracking = 1;</script></head><body></body></html>`;

test("extractLdJsonBlocks finds JSON-LD and ignores other scripts", () => {
  const blocks = extractLdJsonBlocks(GRAPH_PAGE);
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].startsWith("{"));
});

test("extractLdJsonBlocks survives hostile input without hanging", () => {
  const started = Date.now();
  extractLdJsonBlocks("<script " + "a".repeat(2_000_000));
  extractLdJsonBlocks("<script type='application/ld+json'>" + "{".repeat(2_000_000));
  extractLdJsonBlocks("<script>".repeat(200_000));
  assert.ok(Date.now() - started < 2000, "linear time on adversarial input");
});

test("extractLdJsonBlocks caps block count and size", () => {
  const many = '<script type="application/ld+json">{}</script>'.repeat(50);
  assert.equal(extractLdJsonBlocks(many).length, 10);
  const big = `<script type="application/ld+json">${"x".repeat(300_000)}</script>`;
  assert.equal(extractLdJsonBlocks(big).length, 0, "oversized block is dropped, not truncated");
});

test("a Recipe inside @graph is found and mapped", () => {
  const r = importFromPaste(GRAPH_PAGE);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.draft.title, "Garlic & Chilli Prawns");
  assert.equal(r.draft.servings, 4);
  assert.equal(r.draft.prep_minutes, 10);
  assert.equal(r.draft.cook_minutes, 75);
  assert.equal(r.draft.source_url, "https://example.com/prawns");
  assert.equal(r.draft.notes, "Quick & easy.");
  assert.deepEqual(r.draft.tags, ["seafood", "quick", "weeknight", "dinner", "australian"]);
  assert.deepEqual(r.draft.steps, ["Peel the prawns.", "Cook them fast .", "Serve."]);
  assert.deepEqual(r.draft.ingredients[0], { qty: "400", unit: "g", item: "raw prawns" });
  assert.deepEqual(r.draft.ingredients[2], { qty: "1/2", unit: "tsp", item: "chilli flakes" });
  assert.deepEqual(r.draft.ingredients[4], { qty: "", unit: "", item: "salt" });
});

test("an import never claims allium_free, and reports the allium it saw", () => {
  const r = importFromPaste(GRAPH_PAGE);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.draft.allium_free, false);
  assert.deepEqual(r.alliumWords, ["onion"]);

  const clean = importFromPaste("Toast\nIngredients\n2 slices bread\nMethod\nToast it.");
  assert.ok(clean.ok);
  if (!clean.ok) return;
  assert.equal(clean.draft.allium_free, false, "no onion words found is still not a safety claim");
  assert.deepEqual(clean.alliumWords, []);
});

test("a javascript: source URL is dropped, an https one kept", () => {
  const evil = JSON.stringify({ "@type": "Recipe", name: "x", url: "javascript:alert(1)", recipeIngredient: ["1 egg"], recipeInstructions: "Cook." });
  const r = recipeFromJsonLd([evil]);
  assert.equal(r?.draft.source_url, null);
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,hi"), null);
  assert.equal(safeHttpUrl("ftp://x.test"), null);
  assert.equal(safeHttpUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl("not a url"), null);
});

test("malformed or recipe-less JSON-LD falls through cleanly", () => {
  assert.equal(recipeFromJsonLd(["{not json", '{"@type":"WebSite"}', "[]", "null"]), null);
  const r = importFromPaste('<script type="application/ld+json">{"@type":"WebSite"}</script>');
  assert.equal(r.ok, false);
});

test("hostile JSON-LD is bounded: deep nesting, huge strings, wrong types", () => {
  let deep: unknown = { "@type": "Recipe", name: "buried" };
  for (let i = 0; i < 50; i++) deep = { "@graph": deep };
  assert.equal(recipeFromJsonLd([JSON.stringify(deep)]), null, "depth limit stops the search");

  const huge = JSON.stringify({
    "@type": "Recipe", name: "n".repeat(100_000), description: "d".repeat(100_000),
    recipeIngredient: Array.from({ length: 5000 }, () => "1 egg"),
    recipeInstructions: Array.from({ length: 5000 }, () => "Stir."),
    recipeYield: { not: "a string" }, prepTime: { x: 1 }, keywords: 42,
  });
  const r = recipeFromJsonLd([huge]);
  assert.ok(r);
  assert.ok(r!.draft.title.length <= 200);
  assert.ok((r!.draft.notes ?? "").length <= 1000);
  assert.ok(r!.draft.ingredients.length <= 60);
  assert.ok(r!.draft.steps.length <= 60);
  assert.equal(r!.draft.servings, null);
});

test("markup in text is stripped, entities decoded, and nothing is executed", () => {
  assert.equal(cleanText("<img src=x onerror=alert(1)>Bake &amp; serve"), "Bake & serve");
  assert.equal(cleanText("a&#39;b &#x41; &bogus; &#99999999999;"), "a'b A &bogus;");
});

test("durations", () => {
  assert.equal(parseIsoDuration("PT45M"), 45);
  assert.equal(parseIsoDuration("PT1H"), 60);
  assert.equal(parseIsoDuration("P1DT2H"), 1560);
  assert.equal(parseIsoDuration("45 minutes"), null);
  assert.equal(parseIsoDuration("P99999D"), null);
  assert.equal(parseLooseDuration("1 hour 15 mins"), 75);
  assert.equal(parseLooseDuration("20 min"), 20);
  assert.equal(parseLooseDuration("soon"), null);
});

test("ingredient lines: quantity, unit, item", () => {
  const p = parseIngredientLine;
  assert.deepEqual(p("400g plain flour"), { qty: "400", unit: "g", item: "plain flour" });
  assert.deepEqual(p("1 1/2 cups milk"), { qty: "1 1/2", unit: "cup", item: "milk" });
  assert.deepEqual(p("½ tsp salt"), { qty: "½", unit: "tsp", item: "salt" });
  assert.deepEqual(p("2-3 tablespoons olive oil"), { qty: "2-3", unit: "tbsp", item: "olive oil" });
  assert.deepEqual(p("• 3 garlic cloves, sliced"), { qty: "3", unit: "", item: "garlic cloves, sliced" });
  assert.deepEqual(p("1 large onion"), { qty: "1", unit: "", item: "large onion" });
  assert.deepEqual(p("2 tomatoes"), { qty: "2", unit: "", item: "tomatoes" });
  assert.deepEqual(p("1 lemon"), { qty: "1", unit: "", item: "lemon" });
  assert.deepEqual(p("1.5 L water"), { qty: "1.5", unit: "L", item: "water" });
  assert.deepEqual(p("salt and pepper"), { qty: "", unit: "", item: "salt and pepper" });
  assert.deepEqual(p("2 cups"), { qty: "", unit: "", item: "2 cups" }, "a bare quantity keeps the line rather than losing it");
  assert.equal(p("   "), null);
});

test("plain text with headings", () => {
  const r = importFromPaste(`Mum's Lemon Pasta
Serves 4
Prep: 10 min
Cook time: 15 minutes

Ingredients
- 400 g spaghetti
- 2 lemons, zested and juiced
- 60 ml olive oil
- parmesan, to serve

Method
1. Boil the pasta.
2. Toss with oil and lemon.

Notes
Add chilli if you like.`);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.draft.title, "Mum's Lemon Pasta");
  assert.equal(r.draft.servings, 4);
  assert.equal(r.draft.prep_minutes, 10);
  assert.equal(r.draft.cook_minutes, 15);
  assert.equal(r.draft.ingredients.length, 4);
  assert.deepEqual(r.draft.ingredients[0], { qty: "400", unit: "g", item: "spaghetti" });
  assert.deepEqual(r.draft.steps, ["Boil the pasta.", "Toss with oil and lemon."]);
  assert.equal(r.draft.notes, "Add chilli if you like.");
  assert.deepEqual(r.notes, []);
});

test("plain text without headings is sorted by guesswork, and says so", () => {
  const r = importFromPaste(`Quick Eggs
2 eggs
1 tbsp butter
Melt the butter in a pan over a low heat until it foams, then add the eggs and stir gently until just set.`);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.draft.ingredients.length, 2);
  assert.equal(r.draft.steps.length, 1);
  assert.ok(r.notes.some((n) => /guesswork/.test(n)));
});

test("bare JSON-LD and nonsense input", () => {
  const bare = importFromPaste(JSON.stringify({ "@type": "Recipe", name: "Tea", recipeIngredient: ["1 bag tea"], recipeInstructions: "Steep." }));
  assert.ok(bare.ok);
  assert.equal(importFromPaste("   ").ok, false);
  const braces = importFromPaste('{"not":"a recipe"}');
  assert.equal(braces.ok, false, "braces that are not a recipe produce a clear failure, not a crash");
  assert.equal(importFromPaste("hello").ok, false);
});
