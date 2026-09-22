import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./lib/supabase";
import type { Recipe, RecipeDraft } from "./lib/types";
import { Auth } from "./components/Auth";
import { RecipeCard } from "./components/RecipeCard";
import { RecipeDetail } from "./components/RecipeDetail";
import { RecipeForm } from "./components/RecipeForm";

/* Hash routing, hand-rolled rather than a router dependency.
   Two reasons it is a hash and not a path: GitHub Pages has no server-side rewrite, so
   /recipe/<id> would 404 on reload and need an index.html-as-404.html trick; and the
   hash gives working back/forward for free, which matters most on a phone. */
type View = { name: "list" } | { name: "new" } | { name: "detail"; id: string } | { name: "edit"; id: string };

function parseHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "new") return { name: "new" };
  const detail = h.match(/^recipe\/([0-9a-f-]+)$/i);
  if (detail) return { name: "detail", id: detail[1] };
  const edit = h.match(/^recipe\/([0-9a-f-]+)\/edit$/i);
  if (edit) return { name: "edit", id: edit[1] };
  return { name: "list" };
}

const go = (hash: string) => { window.location.hash = hash; };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(parseHash);
  const [query, setQuery] = useState("");
  const [alliumOnly, setAlliumOnly] = useState(false);

  useEffect(() => {
    const onHash = () => setView(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    /* No .eq('user_id', ...) here on purpose. RLS already scopes this to the caller,
       and adding a client-side filter would imply the client is what enforces it. */
    const { data, error } = await supabase
      .from("recipes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else { setError(null); setRecipes(data as Recipe[]); }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (alliumOnly && !r.allium_free) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q)) ||
        r.ingredients.some((i) => i.item.toLowerCase().includes(q))
      );
    });
  }, [recipes, query, alliumOnly]);

  async function create(draft: RecipeDraft) {
    if (!supabase) return;
    const { data, error } = await supabase.from("recipes").insert(draft).select().single();
    if (error) throw error;
    setRecipes((prev) => [data as Recipe, ...prev]);
    go(`#/recipe/${(data as Recipe).id}`);
  }

  async function update(id: string, draft: RecipeDraft) {
    if (!supabase) return;
    const { data, error } = await supabase.from("recipes").update(draft).eq("id", id).select().single();
    if (error) throw error;
    setRecipes((prev) => prev.map((r) => (r.id === id ? (data as Recipe) : r)));
    go(`#/recipe/${id}`);
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!window.confirm("Delete this recipe? This cannot be undone.")) return;
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    go("#/");
  }

  if (!configured) {
    return (
      <div className="rb-auth">
        <h1 className="rb-title">Not configured</h1>
        <p>
          VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing. Locally, copy
          <code> .env.example </code> to <code>.env.local</code> and fill them in. In CI they
          are repository variables. See <code>supabase/schema.sql</code>.
        </p>
      </div>
    );
  }

  if (!ready) return <div className="rb-empty">Loading…</div>;
  if (!session) return <Auth />;

  const current = view.name === "detail" || view.name === "edit"
    ? recipes.find((r) => r.id === view.id)
    : undefined;

  return (
    <div className="rb-shell">
      <header className="rb-header">
        <h1 className="rb-title">Recipe book</h1>
        <span className="rb-count">
          {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
        </span>
        <div className="rb-header-actions">
          {view.name === "list" && (
            <button className="rb-btn rb-btn--primary" onClick={() => go("#/new")}>
              + New
            </button>
          )}
          <button className="rb-btn rb-btn--quiet" onClick={() => supabase?.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="rb-banner rb-banner--error">{error}</div>}

      {view.name === "new" && (
        <RecipeForm onSave={create} onCancel={() => go("#/")} />
      )}

      {view.name === "edit" && current && (
        <RecipeForm
          initial={current}
          onSave={(d) => update(current.id, d)}
          onCancel={() => go(`#/recipe/${current.id}`)}
        />
      )}

      {view.name === "detail" && current && (
        <RecipeDetail
          recipe={current}
          onEdit={() => go(`#/recipe/${current.id}/edit`)}
          onDelete={() => remove(current.id)}
          onBack={() => go("#/")}
        />
      )}

      {/* A stale link, or a recipe deleted on another device. */}
      {(view.name === "detail" || view.name === "edit") && !current && (
        <div className="rb-empty">
          <p>That recipe is not here.</p>
          <button className="rb-btn" onClick={() => go("#/")}>All recipes</button>
        </div>
      )}

      {view.name === "list" && (
        <>
          <div className="rb-filters">
            <input
              className="rb-input rb-search"
              placeholder="Search title, tag or ingredient"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search recipes"
            />
            <button
              className="rb-toggle"
              aria-pressed={alliumOnly}
              onClick={() => setAlliumOnly((v) => !v)}
            >
              {alliumOnly ? "✓ " : ""}Allium-free only
            </button>
          </div>

          {visible.length === 0 ? (
            <div className="rb-empty">
              {recipes.length === 0
                ? "Nothing here yet. Add the first recipe."
                : "No recipes match that."}
            </div>
          ) : (
            <div className="rb-grid">
              {visible.map((r) => (
                <RecipeCard key={r.id} recipe={r} onOpen={() => go(`#/recipe/${r.id}`)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
