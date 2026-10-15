import type { Recipe } from "../lib/types";

const totalTime = (r: Recipe) => (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);

type Props = {
  recipe: Recipe;
  /** Signed URL for this recipe's photo, if it has one and it has been signed yet. */
  photoUrl?: string;
  inPlan: boolean;
  onOpen: () => void;
  onTogglePlan: () => void;
};

/* Two sibling buttons inside a plain container, not a button wrapped around everything:
   a button inside a button is invalid HTML and breaks keyboard and screen-reader use. */
export function RecipeCard({ recipe: r, photoUrl, inPlan, onOpen, onTogglePlan }: Props) {
  return (
    <div className="rb-card">
      <button className="rb-card-main" onClick={onOpen}>
        {photoUrl && (
          // Decorative: the title right below says what it is, so no alt text to repeat it.
          <img className="rb-card-photo" src={photoUrl} alt="" loading="lazy" />
        )}
        <span className="rb-card-body">
          <h2 className="rb-card-title">{r.title}</h2>
          <span className="rb-card-meta">
            {r.servings ? `Serves ${r.servings}` : "—"}
            {totalTime(r) > 0 && ` · ${totalTime(r)} min`}
            {r.rating ? ` · ${"★".repeat(r.rating)}` : ""}
          </span>
          <span className="rb-pills">
            {r.allium_free && <span className="rb-pill rb-pill--allium">Allium-free</span>}
            {r.tags.slice(0, 3).map((t) => <span className="rb-pill" key={t}>{t}</span>)}
          </span>
        </span>
      </button>
      <button
        className="rb-toggle rb-card-plan"
        aria-pressed={inPlan}
        onClick={onTogglePlan}
        aria-label={`${inPlan ? "Remove from" : "Add to"} this week's plan: ${r.title}`}
      >
        {inPlan ? "✓ In plan" : "+ Plan"}
      </button>
    </div>
  );
}
