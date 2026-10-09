/* fetch-recipe-page — fetch a recipe URL for the signed-in user and hand back only the
   schema.org JSON-LD blocks found in it.

   Why this exists: browsers cannot fetch arbitrary recipe sites directly (CORS), so the
   in-app "import from a link" needs a server in the middle.

   Why it is careful: it is a server making requests on a caller's behalf.
     - AUTH: only a signed-in user may call it. The public publishable/anon key is a valid
       token as far as the platform gateway is concerned, so the gateway check alone would
       make this an open proxy for the whole internet. We verify the user ourselves.
     - SSRF: every URL, and every redirect hop, goes through guard.ts first.
     - ABUSE: 8 s timeout, 1.5 MB read cap, 3 redirects, HTML only.
     - MINIMISATION: returns just the JSON-LD blocks, not the page. The browser parses them.
     - NO SECRETS: this function holds none, which is what makes the DNS-rebinding gap
       documented in guard.ts acceptable. Keep it that way.

   Deploy:  supabase functions deploy fetch-recipe-page --no-verify-jwt
   (--no-verify-jwt because the auth check is in this file; see supabase/config.toml.) */

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractLdJsonBlocks } from "../_shared/ldjson.ts";
import { assertPublicUrl, GuardError } from "./guard.ts";

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;
const MAX_REQUEST_BYTES = 4_096;

/* Which web origins may call this from a browser. CORS is not authentication (the JWT is),
   but it stops other sites' pages using a visitor's browser to reach it. Override with the
   ALLOWED_ORIGINS secret (comma separated) if the site moves. */
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://swiners.github.io,http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const json = (body: unknown, status: number, origin: string | null): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

/* A, then AAAA. Either may legitimately be empty; both empty is "no such host". */
async function resolveHost(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, "A").catch(() => [] as string[]),
    Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}

/* Read at most `max` bytes of a body, then stop. Content-Length cannot be trusted (it can
   be absent or a lie, and chunked bodies have none), so the cap is enforced on what is
   actually received. `truncated` tells the caller the body was longer than the cap. */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = body?.getReader();
  if (!reader) return { text: "", truncated: false };

  const all = new Uint8Array(max);
  let filled = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = max - filled;
    all.set(value.subarray(0, room), filled);
    filled += Math.min(value.byteLength, room);
    if (value.byteLength > room) { truncated = true; break; }
    if (filled === max) { truncated = true; break; }
  }
  await reader.cancel().catch(() => {});
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(all.subarray(0, filled)), truncated };
}

async function fetchPage(start: string): Promise<{ html: string; finalUrl: string }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-validated on every hop: a public site can redirect to http://169.254.169.254/.
    const url = await assertPublicUrl(current, resolveHost);

    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "sam-recipes-importer/1.0", Accept: "text/html,application/xhtml+xml" },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw new Error("redirect_without_location");
      current = new URL(location, url).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`upstream_${res.status}`);
    }

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml")) {
      await res.body?.cancel().catch(() => {});
      throw new Error("not_html");
    }
    // Truncation is fine here: JSON-LD sits in <head> or early <body>, and a block cut off
    // by the cap is simply not valid JSON and is skipped by the client.
    return { html: (await readCapped(res.body, MAX_BYTES)).text, finalUrl: url.href };
  }
  throw new Error("too_many_redirects");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const originAllowed = origin !== null && ALLOWED_ORIGINS.includes(origin);

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : new Response(null, { status: 403 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, originAllowed ? origin : null);
  const cors = originAllowed ? origin : null;
  if (origin !== null && !originAllowed) return json({ error: "Origin not allowed." }, 403, null);

  // ── AUTH ─────────────────────────────────────────────────────────────────
  // getUser() asks the Auth server to validate the token and return the user. The public
  // anon/publishable key is not a user, so it returns none and we refuse. A user JWT
  // that merely has a valid signature is not enough on its own either: it must resolve.
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in first." }, 401, cors);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json({ error: "Sign in first." }, 401, cors);

  // ── INPUT ────────────────────────────────────────────────────────────────
  // Size-bound before parsing: this is attacker-controlled JSON, and a chunked body has no
  // Content-Length to check, so the cap is on bytes actually read.
  const { text, truncated } = await readCapped(req.body, MAX_REQUEST_BYTES);
  if (truncated) return json({ error: "Request too large." }, 413, cors);

  let target: unknown;
  try {
    target = JSON.parse(text)?.url;
  } catch {
    return json({ error: "Send JSON like {\"url\":\"https://…\"}." }, 400, cors);
  }
  if (typeof target !== "string") return json({ error: "Send a url." }, 400, cors);

  // ── FETCH ────────────────────────────────────────────────────────────────
  try {
    const { html, finalUrl } = await fetchPage(target);
    return json({ blocks: extractLdJsonBlocks(html), finalUrl }, 200, cors);
  } catch (e) {
    if (e instanceof GuardError) {
      return json({ error: e.message }, e.code === "dns_failed" ? 502 : 400, cors);
    }
    // Deliberately generic: upstream error text is not for the caller, and some of it
    // describes our network. The detail goes to the function log instead.
    console.error("fetch-recipe-page failed:", e instanceof Error ? e.message : "unknown");
    const message = e instanceof Error ? e.message : "";
    if (message === "not_html") return json({ error: "That link is not a web page." }, 422, cors);
    if (message.startsWith("upstream_")) return json({ error: "That site would not let us read the page." }, 502, cors);
    return json({ error: "Could not read that page." }, 502, cors);
  }
});
