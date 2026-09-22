import { useState } from "react";
import type { Ingredient, Recipe, RecipeDraft } from "../lib/types";
import { emptyDraft } from "../lib/types";

type Props = {
  initial?: Recipe;
  onSave: (draft: RecipeDraft) => Promise<void>;
  onCancel: () => void;
};

const toDraft = (r: Recipe): RecipeDraft => ({
  title: r.title,
  servings: r.servings,
  prep_minutes: r.prep_minutes,
  cook_minutes: r.cook_minutes,
  ingredients: r.ingredients.length ? r.ingredients : [{ item: "", qty: "", unit: "" }],
  steps: r.steps.length ? r.steps : [""],
  tags: r.tags,
  allium_free: r.allium_free,
  source_url: r.source_url,
  notes: r.notes,
  rating: r.rating,
  last_cooked: r.last_cooked,
});

/** Empty string -> null, so the database stores an absent value rather than "". */
const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function RecipeForm({ initial, onSave, onCancel }: Props) {
  const [d, setD] = useState<RecipeDraft>(initial ? toDraft(initial) : emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const setIngredient = (i: number, patch: Partial<Ingredient>) =>
    set(
      "ingredients",
      d.ingredients.map((ing, n) => (n === i ? { ...ing, ...patch } : ing)),
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...d,
        title: d.title.trim(),
        // Blank rows are an artefact of the editor, not data worth keeping.
        ingredients: d.ingredients.filter((i) => i.item.trim() !== ""),
        steps: d.steps.map((s) => s.trim()).filter(Boolean),
        tags: d.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <form className="rb-panel" onSubmit={submit}>
      <h2 className="rb-title" style={{ fontSize: 22, marginTop: 0 }}>
        {initial ? "Edit recipe" : "New recipe"}
      </h2>

      {error && <div className="rb-banner rb-banner--error">{error}</div>}

      <div className="rb-field">
        <label className="rb-label" htmlFor="title">Title</label>
        <input
          id="title" className="rb-input" required autoFocus
          value={d.title} onChange={(e) => set("title", e.target.value)}
        />
      </div>

      <div className="rb-row">
        <div className="rb-field">
          <label className="rb-label" htmlFor="servings">Serves</label>
          <input id="servings" className="rb-input" type="number" min="1"
            value={d.servings ?? ""} onChange={(e) => set("servings", numOrNull(e.target.value))} />
        </div>
        <div className="rb-field">
          <label className="rb-label" htmlFor="prep">Prep (min)</label>
          <input id="prep" className="rb-input" type="number" min="0"
            value={d.prep_minutes ?? ""} onChange={(e) => set("prep_minutes", numOrNull(e.target.value))} />
        </div>
        <div className="rb-field">
          <label className="rb-label" htmlFor="cook">Cook (min)</label>
          <input id="cook" className="rb-input" type="number" min="0"
            value={d.cook_minutes ?? ""} onChange={(e) => set("cook_minutes", numOrNull(e.target.value))} />
        </div>
      </div>

      {/* A switch, not a tag. This gets asked of every recipe, so it should not depend
          on having spelled a tag the same way last time. */}
      <div className="rb-field">
        <button
          type="button" className="rb-toggle" aria-pressed={d.allium_free}
          onClick={() => set("allium_free", !d.allium_free)}
        >
          {d.allium_free ? "✓ " : ""}Allium-free
        </button>
        <span className="rb-hint">
          No onion, leek, shallot or chive. Garlic is fine.
        </span>
      </div>

      <div className="rb-section-heading">Ingredients</div>
      {d.ingredients.map((ing, i) => (
        <div className="rb-line" key={i}>
          <input className="rb-input" placeholder="1" aria-label={`Quantity ${i + 1}`}
            value={ing.qty} onChange={(e) => setIngredient(i, { qty: e.target.value })} />
          <input className="rb-input" placeholder="bulb" aria-label={`Unit ${i + 1}`}
            value={ing.unit} onChange={(e) => setIngredient(i, { unit: e.target.value })} />
          <input className="rb-input" placeholder="fennel" aria-label={`Ingredient ${i + 1}`}
            value={ing.item} onChange={(e) => setIngredient(i, { item: e.target.value })} />
          <button type="button" className="rb-btn rb-btn--danger" aria-label={`Remove ingredient ${i + 1}`}
            onClick={() => set("ingredients", d.ingredients.filter((_, n) => n !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="rb-btn rb-btn--quiet"
        onClick={() => set("ingredients", [...d.ingredients, { item: "", qty: "", unit: "" }])}>
        + Add ingredient
      </button>

      <div className="rb-section-heading">Method</div>
      {d.steps.map((step, i) => (
        <div className="rb-line" key={i}>
          <textarea className="rb-textarea" aria-label={`Step ${i + 1}`} value={step}
            onChange={(e) => set("steps", d.steps.map((s, n) => (n === i ? e.target.value : s)))} />
          <button type="button" className="rb-btn rb-btn--danger" aria-label={`Remove step ${i + 1}`}
            onClick={() => set("steps", d.steps.filter((_, n) => n !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="rb-btn rb-btn--quiet" onClick={() => set("steps", [...d.steps, ""])}>
        + Add step
      </button>

      <div className="rb-section-heading">Extras</div>
      <div className="rb-field">
        <label className="rb-label" htmlFor="tags">Tags</label>
        <input id="tags" className="rb-input" placeholder="weeknight, pasta"
          value={d.tags.join(", ")}
          onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()))} />
        <span className="rb-hint">Comma separated.</span>
      </div>
      <div className="rb-row">
        <div className="rb-field">
          <label className="rb-label" htmlFor="rating">Rating</label>
          <select id="rating" className="rb-select" value={d.rating ?? ""}
            onChange={(e) => set("rating", numOrNull(e.target.value))}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
          </select>
        </div>
        <div className="rb-field">
          <label className="rb-label" htmlFor="last">Last cooked</label>
          <input id="last" className="rb-input" type="date" value={d.last_cooked ?? ""}
            onChange={(e) => set("last_cooked", orNull(e.target.value))} />
        </div>
      </div>
      <div className="rb-field">
        <label className="rb-label" htmlFor="source">Source</label>
        <input id="source" className="rb-input" type="url" placeholder="https://…"
          value={d.source_url ?? ""} onChange={(e) => set("source_url", orNull(e.target.value))} />
      </div>
      <div className="rb-field">
        <label className="rb-label" htmlFor="notes">Notes</label>
        <textarea id="notes" className="rb-textarea" value={d.notes ?? ""}
          onChange={(e) => set("notes", orNull(e.target.value))} />
      </div>

      <div className="rb-row" style={{ marginTop: "var(--rb-space-5)" }}>
        <button className="rb-btn rb-btn--primary" type="submit" disabled={busy || !d.title.trim()}>
          {busy ? "Saving…" : "Save recipe"}
        </button>
        <button className="rb-btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
