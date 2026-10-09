import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./lib/supabase";
import type { Recipe, RecipeDraft } from "./lib/types";
import type { PhotoChange } from "./lib/photos";
import { removePhoto, uploadPhoto } from "./lib/photos";
import { usePhotoUrls } from "./lib/usePhotoUrls";
import { usePlan } from "./lib/usePlan";
import { Auth } from "./components/Auth";
import { CatchView } from "./components/CatchView";
import { PlanView } from "./components/PlanView";
import { RecipeCard } from "./components/RecipeCard";
import { RecipeDetail } from "./components/RecipeDetail";
import { RecipeForm } from "./components/RecipeForm";

/* Hash routing, hand-rolled rather than a router dependency.
   Two reasons it is a hash and not a path: GitHub Pages has no server-side rewrite, so
   /recipe/<id> would 404 on reload and need an index.html-as-404.html trick; and the
   hash gives working back/forward for free, which matters most on a phone. */
type View =
  | { name: "list" }
  | { name: "new" }
  | { name: "plan" }
  | { name: "catch" }
  | { name: "detail"; id: string }
  | { name: "edit"; id: string };

function parseHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "new") return { name: "new" };
  if (h === "plan") return { name: "plan" };
  if (h === "catch") return { name: "catch" };
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

  const plan = usePlan();
  const photoUrls = usePhotoUrls(recipes);

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

  /* Photo handling around a save. Order matters, so a failure never loses data:
       upload new  ->  write the row  ->  only then delete the old object.
     If the row write fails, the freshly uploaded object is removed so it is not orphaned.
     If deleting the old object fails, the recipe is still saved correctly and the cost is
     one stray file, which is the right way round to fail. */
  async function create(draft: RecipeDraft, photo: PhotoChange) {
    if (!supabase || !session) return;
    const uploaded = photo.kind === "replace" ? await uploadPhoto(session.user.id, photo.blob) : null;
    const { data, error } = await supabase
      .from("recipes")
      .insert({ ...draft, photo_path: uploaded })
      .select()
      .single();
    if (error) {
      await removePhoto(uploaded);
      throw error;
    }
    setRecipes((prev) => [data as Recipe, ...prev]);
    go(`#/recipe/${(data as Recipe).id}`);
  }

  async function update(id: string, draft: RecipeDraft, photo: PhotoChange) {
    if (!supabase || !session) return;
    const old = recipes.find((r) => r.id === id)?.photo_path ?? null;

    const uploaded = photo.kind === "replace" ? await uploadPhoto(session.user.id, photo.blob) : null;
    const photo_path = photo.kind === "replace" ? uploaded : photo.kind === "remove" ? null : old;

    const { data, error } = await supabase
      .from("recipes")
      .update({ ...draft, photo_path })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      await removePhoto(uploaded);
      throw error;
    }
    if (photo.kind !== "keep") await removePhoto(old);
    setRecipes((prev) => prev.map((r) => (r.id === id ? (data as Recipe) : r)));
    go(`#/recipe/${id}`);
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!window.confirm("Delete this recipe? This cannot be undone.")) return;
    const photo = recipes.find((r) => r.id === id)?.photo_path ?? null;
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    await removePhoto(photo);
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

  const showNav = view.name === "list" || view.name === "plan" || view.name === "catch";
  const planCount = plan.plan.filter((p) => recipes.some((r) => r.id === p.id)).length;

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

      {showNav && (
        <nav className="rb-nav" aria-label="Sections">
          <button className="rb-tab" aria-current={view.name === "list" ? "page" : undefined} onClick={() => go("#/")}>
            Recipes
          </button>
          <button className="rb-tab" aria-current={view.name === "plan" ? "page" : undefined} onClick={() => go("#/plan")}>
            Plan{planCount > 0 ? ` (${planCount})` : ""}
          </button>
          <button className="rb-tab" aria-current={view.name === "catch" ? "page" : undefined} onClick={() => go("#/catch")}>
            Catch
          </button>
        </nav>
      )}

      {error && <div className="rb-banner rb-banner--error">{error}</div>}

      {view.name === "new" && (
        <RecipeForm onSave={create} onCancel={() => go("#/")} />
      )}

      {view.name === "edit" && current && (
        <RecipeForm
          initial={current}
          photoUrl={current.photo_path ? photoUrls[current.photo_path] : undefined}
          onSave={(d, p) => update(current.id, d, p)}
          onCancel={() => go(`#/recipe/${current.id}`)}
        />
      )}

      {view.name === "detail" && current && (
        <RecipeDetail
          key={current.id}
          recipe={current}
          photoUrl={current.photo_path ? photoUrls[current.photo_path] : undefined}
          inPlan={plan.has(current.id)}
          onTogglePlan={() => plan.toggle(current.id, current.servings)}
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

      {view.name === "plan" && (
        <PlanView
          recipes={recipes}
          plan={plan}
          onOpen={(id) => go(`#/recipe/${id}`)}
          onBrowse={() => go("#/")}
        />
      )}

      {view.name === "catch" && (
        <CatchView recipes={recipes} onOpen={(id) => go(`#/recipe/${id}`)} />
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
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  photoUrl={r.photo_path ? photoUrls[r.photo_path] : undefined}
                  inPlan={plan.has(r.id)}
                  onOpen={() => go(`#/recipe/${r.id}`)}
                  onTogglePlan={() => plan.toggle(r.id, r.servings)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
