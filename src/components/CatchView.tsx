import { useMemo, useState } from "react";
import type { Recipe } from "../lib/types";
import { matchSpecies, SPECIES, speciesCounts } from "../lib/catch";

type Props = {
  recipes: Recipe[];
  onOpen: (id: string) => void;
};

/* "Caught it, now cook it." Pick what is in the bag, see what to do with it. */
export function CatchView({ recipes, onOpen }: Props) {
  const [name, setName] = useState<string | null>(null);

  const counts = useMemo(() => speciesCounts(recipes), [recipes]);
  const species = SPECIES.find((s) => s.name === name) ?? null;
  const matches = useMemo(() => (species ? matchSpecies(recipes, species) : []), [recipes, species]);

  const made = matches.filter((m) => m.tier === "made");
  const also = matches.filter((m) => m.tier === "also");

  return (
    <div>
      <p className="rb-hint" style={{ marginTop: 0 }}>What is in the bag?</p>

      <div className="rb-chips" role="group" aria-label="Species">
        {counts.map(({ species: s, count }) => (
          <button
            key={s.name}
            className="rb-toggle"
            aria-pressed={name === s.name}
            onClick={() => setName(name === s.name ? null : s.name)}
          >
            {s.name} <span className="rb-chip-count">{count}</span>
          </button>
        ))}
      </div>

      {!species && (
        <div className="rb-empty">Pick a fish to see what to cook with it.</div>
      )}

      {species && matches.length === 0 && (
        <div className="rb-empty">
          <p>No recipes mention {species.name.toLowerCase()} yet.</p>
          <p className="rb-hint">Add one and it will show up here.</p>
        </div>
      )}

      {made.length > 0 && (
        <>
          <div className="rb-section-heading">Made for {species?.name.toLowerCase()}</div>
          <ResultList items={made.map((m) => m.recipe)} onOpen={onOpen} />
        </>
      )}
      {also.length > 0 && (
        <>
          <div className="rb-section-heading">Also works</div>
          <ResultList items={also.map((m) => m.recipe)} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

function ResultList({ items, onOpen }: { items: Recipe[]; onOpen: (id: string) => void }) {
  return (
    <ul className="rb-result-list">
      {items.map((r) => (
        <li key={r.id}>
          <button className="rb-result" onClick={() => onOpen(r.id)}>
            <span className="rb-result-title">{r.title}</span>
            <span className="rb-card-meta">
              {(r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) > 0 && `${(r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)} min`}
              {r.allium_free && " · allium-free"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
