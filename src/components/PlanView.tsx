import { useMemo, useState } from "react";
import type { Recipe } from "../lib/types";
import { MAX_SERVINGS, plannedRecipes, shoppingList, shoppingListText } from "../lib/plan";
import type { usePlan } from "../lib/usePlan";

type Props = {
  recipes: Recipe[];
  plan: ReturnType<typeof usePlan>;
  onOpen: (id: string) => void;
  onBrowse: () => void;
};

export function PlanView({ recipes, plan, onOpen, onBrowse }: Props) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  // Recipes deleted since they were planned simply drop out here.
  const planned = useMemo(() => plannedRecipes(plan.plan, recipes), [plan.plan, recipes]);
  const rows = useMemo(() => shoppingList(planned), [planned]);

  const notAlliumFree = planned.filter((p) => !p.recipe.allium_free).map((p) => p.recipe.title);
  const remaining = rows.filter((r) => !plan.ticked.has(r.key)).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shoppingListText(rows, plan.ticked));
      setCopied("ok");
    } catch {
      // Clipboard needs a secure context and a user gesture; either can be missing.
      setCopied("failed");
    }
  }

  if (planned.length === 0) {
    return (
      <div className="rb-empty">
        <p>Nothing planned yet.</p>
        <p>Tap <strong>+ Plan</strong> on any recipe and the shopping list builds itself here.</p>
        <button className="rb-btn rb-btn--primary" onClick={onBrowse}>Browse recipes</button>
      </div>
    );
  }

  return (
    <div className="rb-plan">
      {notAlliumFree.length > 0 && (
        <div className="rb-banner rb-banner--info" role="status">
          Not marked allium-free: {notAlliumFree.join(", ")}.
        </div>
      )}

      <section className="rb-panel">
        <div className="rb-plan-head">
          <h2 className="rb-title" style={{ fontSize: 22 }}>This week</h2>
          <button className="rb-btn rb-btn--quiet" onClick={() => { if (window.confirm("Clear the plan and the shopping list?")) plan.clearAll(); }}>
            Clear all
          </button>
        </div>
        <ul className="rb-plan-list">
          {planned.map(({ recipe, servings }) => (
            <li key={recipe.id} className="rb-plan-item">
              <button className="rb-linklike rb-plan-title" onClick={() => onOpen(recipe.id)}>{recipe.title}</button>
              <div className="rb-stepper" role="group" aria-label={`Servings for ${recipe.title}`}>
                <button type="button" className="rb-btn" aria-label="Fewer servings"
                  disabled={(servings ?? 1) <= 1}
                  onClick={() => plan.setServings(recipe.id, (servings ?? 2) - 1)}>−</button>
                <span className="rb-stepper-value">{servings ?? "—"}</span>
                <button type="button" className="rb-btn" aria-label="More servings"
                  disabled={(servings ?? 1) >= MAX_SERVINGS}
                  onClick={() => plan.setServings(recipe.id, (servings ?? 1) + 1)}>+</button>
              </div>
              <button className="rb-btn rb-btn--danger" aria-label={`Remove ${recipe.title} from the plan`}
                onClick={() => plan.remove(recipe.id)}>×</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rb-panel" style={{ marginTop: "var(--rb-space-4)" }}>
        <div className="rb-plan-head">
          <h2 className="rb-title" style={{ fontSize: 22 }}>Shopping list</h2>
          <span className="rb-count">{remaining} to get</span>
        </div>

        <ul className="rb-shop">
          {rows.map((row) => {
            const done = plan.ticked.has(row.key);
            return (
              <li key={row.key}>
                <label className={`rb-shop-row${done ? " rb-shop-row--done" : ""}`}>
                  <input type="checkbox" checked={done} onChange={() => plan.toggleTicked(row.key)} />
                  <span className="rb-shop-amount">{row.amounts.join(" + ")}</span>
                  <span className="rb-shop-item">{row.item}</span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="rb-row" style={{ marginTop: "var(--rb-space-4)" }}>
          <button className="rb-btn" onClick={copy}>Copy list</button>
          <button className="rb-btn rb-btn--quiet" onClick={plan.clearTicked} disabled={plan.ticked.size === 0}>
            Untick all
          </button>
        </div>
        {copied === "ok" && <p className="rb-hint" role="status">Copied. Ticked items are left off.</p>}
        {copied === "failed" && <p className="rb-hint" role="status">Could not copy from here. Select the list and copy it by hand.</p>}
        <p className="rb-hint" style={{ marginTop: "var(--rb-space-3)" }}>
          Quantities are added up across recipes where the units match. Check them before you shop:
          this device keeps the plan, and other devices do not see it.
        </p>
      </section>
    </div>
  );
}
