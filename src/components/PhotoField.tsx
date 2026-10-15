import { useEffect, useRef, useState } from "react";
import { prepareImage } from "../lib/photos";
import type { PhotoChange } from "../lib/photos";

type Props = {
  /** Signed URL of the photo the recipe already has, if any. */
  currentUrl?: string;
  hasPhoto: boolean;
  change: PhotoChange;
  onChange: (change: PhotoChange) => void;
};

export function PhotoField({ currentUrl, hasPhoto, change, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // An object URL holds the image in memory until it is revoked. It is created in the
  // event handler that picks the file (not in an effect), and the previous one is released
  // whenever it is replaced, cleared, or the field goes away.
  const live = useRef<string | null>(null);
  const swapPreview = (next: string | null) => {
    if (live.current) URL.revokeObjectURL(live.current);
    live.current = next;
    setPreview(next);
  };
  useEffect(() => () => { if (live.current) URL.revokeObjectURL(live.current); }, []);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again after removing it still fires a change.
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await prepareImage(file);
      swapPreview(URL.createObjectURL(blob));
      onChange({ kind: "replace", blob });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that photo.");
    } finally {
      setBusy(false);
    }
  }

  const undo = () => {
    swapPreview(null);
    onChange(change.kind === "replace" ? { kind: "keep" } : { kind: "remove" });
  };

  const shown = change.kind === "replace" ? preview : change.kind === "remove" ? null : (currentUrl ?? null);
  const canRemove = change.kind === "replace" || (change.kind === "keep" && hasPhoto);

  return (
    <div className="rb-field">
      <span className="rb-label">Photo</span>
      {shown && <img className="rb-photo-preview" src={shown} alt="Photo of this recipe" />}
      {error && <div className="rb-banner rb-banner--error" role="alert">{error}</div>}
      <div className="rb-row" style={{ alignItems: "center" }}>
        {/* A real file input styled as a button: it opens the camera or library on a phone. */}
        <label className="rb-btn rb-file">
          {busy ? "Preparing…" : shown ? "Change photo" : "Add photo"}
          <input type="file" accept="image/*" onChange={pick} disabled={busy} hidden />
        </label>
        {canRemove && (
          <button type="button" className="rb-btn rb-btn--danger" onClick={undo}>
            {change.kind === "replace" && hasPhoto ? "Keep the old one" : "Remove photo"}
          </button>
        )}
      </div>
      <span className="rb-hint">Shrunk on this device, and location data is stripped before upload.</span>
    </div>
  );
}
