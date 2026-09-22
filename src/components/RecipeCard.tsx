import type { Recipe } from "../lib/types";

const totalTime = (r: Recipe) => (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);

export function RecipeCard({ recipe: r, onOpen }: { recipe: Recipe; onOpen: () => void }) {
  return (
    <button className="rb-card" onClick={onOpen}>
      <h2 className="rb-card-title">{r.title}</h2>
      <span className="rb-card-meta">
        {r.servings ? `Serves ${r.servings}` : "—"}
        {totalTime(r) > 0 && ` · ${totalTime(r)} min`}
        {r.rating ? ` · ${"★".repeat(r.rating)}` : ""}
      </span>
      <div className="rb-pills">
        {r.allium_free && <span className="rb-pill rb-pill--allium">Allium-free</span>}
        {r.tags.slice(0, 3).map((t) => <span className="rb-pill" key={t}>{t}</span>)}
      </div>
    </button>
  );
}
