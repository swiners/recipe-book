/* "Caught it, now cook it": find recipes by the fish or seafood in hand.

   Matching is on words in the recipe's own text, not a species column. That needs no
   schema change and means a recipe that says "flathead, whiting or Australian salmon"
   shows up under all three, which is what you want standing at the sink with a bag of
   whichever the day gave you.

   Two tiers, because a recipe built for a fish and a recipe that merely tolerates it are
   different answers:
     made  - the species is in the title
     also  - it is named somewhere else (ingredients, notes, tags), usually as a swap */

import type { Recipe } from "./types.ts";

export type Species = { name: string; pattern: RegExp };

/* Whole-word, case-insensitive. "Australian salmon" and farmed "salmon" are different
   fish that people cook differently, so plain salmon refuses to match the former. */
export const SPECIES: Species[] = [
  { name: "Flathead", pattern: /\bflathead\b/i },
  { name: "Bream", pattern: /\bbream\b/i },
  { name: "Whiting", pattern: /\bwhiting\b/i },
  { name: "Garfish", pattern: /\bgarfish\b/i },
  { name: "Snapper", pattern: /\bsnapper\b/i },
  { name: "Trevally", pattern: /\btrevally\b/i },
  { name: "Mulloway", pattern: /\b(?:mulloway|jewfish)\b/i },
  { name: "Flounder", pattern: /\bflounder\b/i },
  { name: "Australian salmon", pattern: /\b(?:australian|aussie) salmon\b/i },
  { name: "Salmon", pattern: /(?<!\b(?:australian|aussie) )\bsalmon\b/i },
  { name: "Squid", pattern: /\b(?:squid|calamari)\b/i },
  { name: "Prawns", pattern: /\bprawns?\b/i },
];

export type Match = { recipe: Recipe; tier: "made" | "also" };

const searchable = (r: Recipe): string =>
  [...r.ingredients.map((i) => i.item), r.notes ?? "", ...r.tags].join("\n");

export function matchSpecies(recipes: Recipe[], species: Species): Match[] {
  const out: Match[] = [];
  for (const recipe of recipes) {
    if (species.pattern.test(recipe.title)) out.push({ recipe, tier: "made" });
    else if (species.pattern.test(searchable(recipe))) out.push({ recipe, tier: "also" });
  }
  // Made-for before also-works, then the ones you rate highest.
  return out.sort(
    (a, b) =>
      Number(b.tier === "made") - Number(a.tier === "made") || (b.recipe.rating ?? 0) - (a.recipe.rating ?? 0),
  );
}

export const speciesCounts = (recipes: Recipe[]): { species: Species; count: number }[] =>
  SPECIES.map((species) => ({ species, count: matchSpecies(recipes, species).length }));
