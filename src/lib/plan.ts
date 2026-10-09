/* The week's plan: which recipes, at how many servings, and which shopping items are
   already in the trolley.

   Stored in this device's localStorage, not in the database. That is a deliberate scope
   call: a plan is scratch space that changes weekly, and putting it in Supabase would mean
   a new table, new policies and a migration for something disposable. The cost is that the
   plan is per device (phone and laptop do not share one). The README says so.

   localStorage is readable and writable by anything running in this origin and by the
   person at the keyboard, so what comes out of it is validated like any other input. */

import { buildShoppingList, scaleFactor, scaleQty } from "./quantity.ts";
import type { Line, ShoppingRow } from "./quantity.ts";
import type { Recipe } from "./types.ts";

export type PlanEntry = { id: string; servings: number | null };

export const PLAN_KEY = "rb-plan";
export const TICKED_KEY = "rb-ticked";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PLAN = 30;
export const MAX_SERVINGS = 100;

/** Parse what was stored, keeping only entries that are well-formed. Never throws. */
export function parsePlan(raw: string | null): PlanEntry[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: PlanEntry[] = [];
  for (const e of value) {
    if (out.length >= MAX_PLAN) break;
    if (!e || typeof e !== "object") continue;
    const { id, servings } = e as Record<string, unknown>;
    if (typeof id !== "string" || !UUID.test(id) || seen.has(id)) continue;
    const ok = typeof servings === "number" && Number.isInteger(servings) && servings >= 1 && servings <= MAX_SERVINGS;
    seen.add(id);
    out.push({ id, servings: ok ? servings : null });
  }
  return out;
}

export function parseTicked(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length < 200).slice(0, 500) : [];
  } catch {
    return [];
  }
}

export const clampServings = (n: number): number => Math.min(MAX_SERVINGS, Math.max(1, Math.round(n)));

/** The planned recipes that still exist (a recipe may have been deleted since), in plan order. */
export function plannedRecipes(plan: PlanEntry[], recipes: Recipe[]): { recipe: Recipe; servings: number | null }[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  return plan.flatMap((p) => {
    const recipe = byId.get(p.id);
    return recipe ? [{ recipe, servings: p.servings ?? recipe.servings }] : [];
  });
}

/** Ingredient lines for the whole plan, each scaled to its planned servings. */
export function planLines(planned: { recipe: Recipe; servings: number | null }[]): Line[] {
  return planned.flatMap(({ recipe, servings }) => {
    const factor = scaleFactor(servings ?? recipe.servings ?? 0, recipe.servings);
    return recipe.ingredients
      .filter((i) => i.item.trim() !== "")
      .map((i) => ({ qty: scaleQty(i.qty, factor), unit: i.unit, item: i.item }));
  });
}

export const shoppingList = (planned: { recipe: Recipe; servings: number | null }[]): ShoppingRow[] =>
  buildShoppingList(planLines(planned));

/** Plain text for pasting into a notes app or message. Un-ticked items only. */
export function shoppingListText(rows: ShoppingRow[], ticked: Set<string>): string {
  return rows
    .filter((r) => !ticked.has(r.key))
    .map((r) => `- ${[r.amounts.join(" + "), r.item].filter(Boolean).join(" ")}`)
    .join("\n");
}
