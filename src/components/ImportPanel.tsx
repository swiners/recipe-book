import { useState } from "react";
import { importFromPaste } from "../lib/importRecipe";
import type { ImportResult } from "../lib/importRecipe";
import { fetchRecipeFromUrl } from "../lib/importFromUrl";

type Props = {
  /** Called with a parsed recipe. The form decides how to merge it in. */
  onImported: (result: ImportResult) => void;
};

/* Fill the new-recipe form from a link or from pasted text, so adding something from a
   phone is "paste, check, save" rather than typing it out. Always lands in the form for
   review: an import is a first draft, never a save. */
export function ImportPanel({ onImported }: Props) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function fromUrl(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const outcome = await fetchRecipeFromUrl(url);
    setBusy(false);
    if (outcome.ok) {
      onImported(outcome);
      setMessage({ kind: "info", text: "Filled in below. Check it over before saving." });
    } else {
      setMessage({ kind: "error", text: outcome.reason });
    }
  }

  function fromText(e: React.FormEvent) {
    e.preventDefault();
    const outcome = importFromPaste(text);
    if (outcome.ok) {
      onImported(outcome);
      setMessage({ kind: "info", text: "Filled in below. Check it over before saving." });
    } else {
      setMessage({ kind: "error", text: outcome.reason });
    }
  }

  return (
    <details className="rb-import">
      <summary>Import from a link or pasted text</summary>

      {message && (
        <div className={`rb-banner rb-banner--${message.kind === "error" ? "error" : "info"}`} role="status">
          {message.text}
        </div>
      )}

      <form onSubmit={fromUrl} className="rb-import-block">
        <label className="rb-label" htmlFor="import-url">From a link</label>
        <div className="rb-line">
          <input id="import-url" className="rb-input" type="url" inputMode="url" placeholder="https://…"
            value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="rb-btn" type="submit" disabled={busy || url.trim() === ""}>
            {busy ? "Fetching…" : "Fetch"}
          </button>
        </div>
        <span className="rb-hint">Works for sites that publish a structured recipe, which most big ones do.</span>
      </form>

      <form onSubmit={fromText} className="rb-import-block">
        <label className="rb-label" htmlFor="import-text">Or paste the recipe</label>
        <textarea id="import-text" className="rb-textarea" rows={6}
          placeholder={"Title\nServes 4\n\nIngredients\n400 g spaghetti\n…\n\nMethod\n1. Boil the pasta.\n…"}
          value={text} onChange={(e) => setText(e.target.value)} />
        <div>
          <button className="rb-btn" type="submit" disabled={text.trim() === ""}>Fill the form</button>
        </div>
        <span className="rb-hint">
          Text with Ingredients and Method headings works best. A page's source also works.
        </span>
      </form>
    </details>
  );
}
