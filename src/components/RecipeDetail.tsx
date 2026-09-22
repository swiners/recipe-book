import type { Recipe } from "../lib/types";

type Props = {
  recipe: Recipe;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
};

const totalTime = (r: Recipe) => (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);

export function RecipeDetail({ recipe: r, onEdit, onDelete, onBack }: Props) {
  return (
    <article className="rb-panel">
      <button className="rb-btn rb-btn--quiet" onClick={onBack}>← All recipes</button>

      <h1 className="rb-title" style={{ marginTop: "var(--rb-space-4)" }}>{r.title}</h1>

      <div className="rb-pills">
        {r.allium_free && <span className="rb-pill rb-pill--allium">Allium-free</span>}
        {r.tags.map((t) => <span className="rb-pill" key={t}>{t}</span>)}
      </div>

      <p className="rb-card-meta" style={{ marginTop: "var(--rb-space-3)" }}>
        {r.servings && <>Serves {r.servings}</>}
        {totalTime(r) > 0 && <> · {totalTime(r)} min</>}
        {r.rating && <> · {"★".repeat(r.rating)}</>}
        {r.last_cooked && <> · last cooked {r.last_cooked}</>}
      </p>

      {r.ingredients.length > 0 && (
        <>
          <div className="rb-section-heading">Ingredients</div>
          <ul className="rb-list">
            {r.ingredients.map((i, n) => (
              <li key={n}>{[i.qty, i.unit, i.item].filter(Boolean).join(" ")}</li>
            ))}
          </ul>
        </>
      )}

      {r.steps.length > 0 && (
        <>
          <div className="rb-section-heading">Method</div>
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
          {/* noreferrer as well as noopener: this is a link the user pasted in, and there
              is no reason to leak this page's URL to it. */}
          <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_url}</a>
        </>
      )}

      <div className="rb-row" style={{ marginTop: "var(--rb-space-6)" }}>
        <button className="rb-btn" onClick={onEdit}>Edit</button>
        <button className="rb-btn rb-btn--danger" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}
