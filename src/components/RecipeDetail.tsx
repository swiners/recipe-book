import { useState } from "react";
import type { Recipe } from "../lib/types";
import { scaleFactor, scaleQty } from "../lib/quantity";
import { MAX_SERVINGS } from "../lib/plan";
import { safeHttpUrl } from "../lib/url";

type Props = {
  recipe: Recipe;
  photoUrl?: string;
  inPlan: boolean;
  onTogglePlan: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
};

const totalTime = (r: Recipe) => (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);

export function RecipeDetail({ recipe: r, photoUrl, inPlan, onTogglePlan, onEdit, onDelete, onBack }: Props) {
  // The target servings live here, not in the database: scaling is a view on the recipe,
  // not an edit to it. It resets when you open a different recipe (the parent re-keys us).
  const [serves, setServes] = useState<number>(r.servings ?? 0);
  const factor = scaleFactor(serves, r.servings);
  const scaled = r.servings !== null && serves !== r.servings;

  // Validated again here even though it is checked on save and import: an older row or a
  // direct API write may hold a `javascript:` URL, and this is the last place it could run.
  const source = safeHttpUrl(r.source_url);

  return (
    <article className="rb-panel">
      <button className="rb-btn rb-btn--quiet" onClick={onBack}>← All recipes</button>

      {photoUrl && <img className="rb-hero" src={photoUrl} alt={r.title} />}

      <h1 className="rb-title" style={{ marginTop: "var(--rb-space-4)" }}>{r.title}</h1>

      <div className="rb-pills">
        {r.allium_free && <span className="rb-pill rb-pill--allium">Allium-free</span>}
        {r.tags.map((t) => <span className="rb-pill" key={t}>{t}</span>)}
      </div>

      <p className="rb-card-meta" style={{ marginTop: "var(--rb-space-3)" }}>
        {totalTime(r) > 0 && <>{totalTime(r)} min</>}
        {r.rating && <>{totalTime(r) > 0 ? " · " : ""}{"★".repeat(r.rating)}</>}
        {r.last_cooked && <> · last cooked {r.last_cooked}</>}
      </p>

      <div className="rb-row rb-detail-actions">
        {r.servings !== null && (
          <div className="rb-stepper" role="group" aria-label="Servings">
            <button type="button" className="rb-btn" aria-label="Fewer servings"
              disabled={serves <= 1} onClick={() => setServes((n) => Math.max(1, n - 1))}>−</button>
            <span className="rb-stepper-value" aria-live="polite">Serves {serves}</span>
            <button type="button" className="rb-btn" aria-label="More servings"
              disabled={serves >= MAX_SERVINGS} onClick={() => setServes((n) => Math.min(MAX_SERVINGS, n + 1))}>+</button>
          </div>
        )}
        <button className="rb-toggle" aria-pressed={inPlan} onClick={onTogglePlan}>
          {inPlan ? "✓ In this week's plan" : "+ Add to plan"}
        </button>
      </div>

      {r.ingredients.length > 0 && (
        <>
          <div className="rb-section-heading">Ingredients</div>
          {scaled && (
            <p className="rb-hint rb-scale-note">
              Scaled from {r.servings} to {serves}.{" "}
              <button type="button" className="rb-linklike" onClick={() => setServes(r.servings ?? 0)}>Reset</button>
            </p>
          )}
          <ul className="rb-list">
            {r.ingredients.map((i, n) => (
              <li key={n}>{[scaleQty(i.qty, factor), i.unit, i.item].filter(Boolean).join(" ")}</li>
            ))}
          </ul>
        </>
      )}

      {r.steps.length > 0 && (
        <>
          <div className="rb-section-heading">Method</div>
          {scaled && (
            <p className="rb-hint rb-scale-note">
              Amounts written inside the method steps are not scaled. Check them against the ingredient list.
            </p>
          )}
          <ol className="rb-list">
            {r.steps.map((s, n) => <li key={n}>{s}</li>)}
          </ol>
        </>
      )}

      {r.notes && (
        <>
          <div className="rb-section-heading">Notes</div>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.notes}</p>
        </>
      )}

      {r.source_url && (
        <>
          <div className="rb-section-heading">Source</div>
          {source ? (
            // noreferrer as well as noopener: this is a link the user pasted in, and there
            // is no reason to leak this page's URL to it.
            <a href={source} target="_blank" rel="noopener noreferrer">{source}</a>
          ) : (
            // Not a web link, so it is shown as plain text and never as something to click.
            <span>{r.source_url}</span>
          )}
        </>
      )}

      <div className="rb-row" style={{ marginTop: "var(--rb-space-6)" }}>
        <button className="rb-btn" onClick={onEdit}>Edit</button>
        <button className="rb-btn rb-btn--danger" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}
