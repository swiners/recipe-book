import { useEffect, useMemo, useState } from "react";
import { signPhotoUrls } from "./photos.ts";
import type { Recipe } from "./types.ts";

/* The bucket is private, so every photo needs a signed URL, and those expire (an hour).
   This keeps one map of path -> URL for the whole app, signed in a single request, and
   quietly re-signs before expiry and whenever the tab comes back to the foreground, which
   is when a phone has typically been asleep for longer than an hour. */
const REFRESH_MS = 50 * 60 * 1000;

export function usePhotoUrls(recipes: Recipe[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});

  // A stable string key, so the effect re-runs when the SET of photos changes and not on
  // every render or every unrelated recipe edit.
  const key = useMemo(
    () => [...new Set(recipes.map((r) => r.photo_path).filter((p): p is string => !!p))].sort().join("\n"),
    [recipes],
  );

  useEffect(() => {
    const paths = key ? key.split("\n") : [];
    let cancelled = false;

    const refresh = async () => {
      const next = await signPhotoUrls(paths);
      if (!cancelled) setUrls(next);
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);

  return urls;
}
