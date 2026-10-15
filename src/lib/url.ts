/* A source link is shown as a clickable <a href>. Anything that reaches that attribute has
   to be http(s): `javascript:` and `data:` URLs are valid URLs that a type="url" input
   happily accepts, and clicking one runs script in this origin, which holds the session.

   Used where a link is saved, imported, and rendered, because any one of those can be
   bypassed (an old row, an import, a direct API write) and the render is the last stop. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
