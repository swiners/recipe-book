import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase.ts";
import { recipeFromJsonLd } from "./importRecipe.ts";
import type { ImportOutcome } from "./importRecipe.ts";
import { safeHttpUrl } from "./url.ts";

const FUNCTION = "fetch-recipe-page";

/** Turn a failed function call into a sentence a person can act on. */
async function explain(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    if (res.status === 404) {
      return "Importing from a link is not set up on this project yet. Paste the recipe text instead.";
    }
    try {
      const body: unknown = await res.json();
      const message = (body as { error?: unknown })?.error;
      // The function's own messages are short and written for people. Cap anyway: this
      // string is shown as text, and nothing about it should be able to grow unbounded.
      if (typeof message === "string" && message) return message.slice(0, 200);
    } catch { /* fall through to the generic message */ }
    return `The import service refused that (status ${res.status}).`;
  }
  if (error instanceof FunctionsFetchError) return "Could not reach the import service. Check your connection, or paste the recipe text instead.";
  return "Something went wrong importing that link.";
}

/** Ask the Edge Function to fetch a recipe page, then read the recipe out of what it returns. */
export async function fetchRecipeFromUrl(url: string): Promise<ImportOutcome> {
  if (!supabase) return { ok: false, reason: "Not connected." };

  // Checked here as well as on the server: the server is the real control, this just
  // gives a faster and clearer answer for an obviously wrong address.
  const safe = safeHttpUrl(url);
  if (!safe) return { ok: false, reason: "That does not look like a web address. It needs to start with http:// or https://." };

  // The user's session token is attached automatically by supabase-js. The function
  // refuses anyone who is not signed in; see supabase/functions/fetch-recipe-page/index.ts.
  const { data, error } = await supabase.functions.invoke(FUNCTION, { body: { url: safe } });
  if (error) return { ok: false, reason: await explain(error) };

  const blocks: string[] = Array.isArray(data?.blocks)
    ? data.blocks.filter((b: unknown): b is string => typeof b === "string")
    : [];

  const result = recipeFromJsonLd(blocks);
  if (!result) {
    return { ok: false, reason: "That page does not publish a structured recipe. Copy the recipe text from it and paste it instead." };
  }
  if (!result.draft.source_url) {
    result.draft.source_url = safeHttpUrl(typeof data?.finalUrl === "string" ? data.finalUrl : safe);
  }
  return { ok: true, ...result };
}
