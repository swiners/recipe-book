#!/usr/bin/env node
/* Probe a live Supabase project (and optionally the published site) for the ways this app
   goes wrong. Run it after setup, and again after any change to schema.sql or the function.

     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
     SITE_URL=https://swiners.github.io/recipe-book/ \
     npm run verify:deploy

   (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY work too, so a .env.local can be
   sourced.) Everything here is done SIGNED OUT, with only the publishable key: it checks
   what a stranger could do. It never sends your session, never writes, and never prints
   the key. Exits 1 if any check fails.

   Why these checks: the bundle is public by design and Row Level Security is the only lock
   on the data, and RLS failures are silent. A missing policy looks like "no recipes yet";
   a too-loose one looks like everything working. These are the questions that would
   otherwise go unasked. */

import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 10_000;

/** @typedef {{ name: string, status: "pass" | "fail" | "warn", detail: string }} Result */

/**
 * @param {{ url: string, key: string, siteUrl?: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<Result[]>}
 */
export async function verify({ url, key, siteUrl, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, "");
  const results = [];
  const add = (name, status, detail) => results.push({ name, status, detail });

  const call = async (target, init = {}) => {
    try {
      const res = await fetchImpl(target, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      let text = "";
      try { text = await res.text(); } catch { /* body unreadable; status still counts */ }
      return { status: res.status, text };
    } catch (e) {
      return { status: 0, text: "", error: e instanceof Error ? e.message : "request failed" };
    }
  };
  const headers = { apikey: key };

  // 1. Row Level Security: a stranger must get nothing. ─────────────────────────────────
  {
    const name = "Signed-out visitors cannot read recipes";
    const r = await call(`${base}/rest/v1/recipes?select=id&limit=1`, { headers });
    if (r.status === 0) add(name, "fail", `Could not reach the project (${r.error}). Check the URL.`);
    else if (r.status === 401 || r.status === 403) add(name, "pass", `Refused with ${r.status}.`);
    else if (r.status === 404) add(name, "fail", "No recipes table found. Has supabase/schema.sql been run?");
    else if (r.status === 200) {
      let rows;
      try { rows = JSON.parse(r.text); } catch { rows = null; }
      if (Array.isArray(rows) && rows.length === 0) add(name, "pass", "Returned an empty list.");
      else if (Array.isArray(rows)) add(name, "fail", "A signed-out request returned recipes. The data is public: fix the policies before anything else.");
      else add(name, "fail", "Unexpected response shape.");
    } else add(name, "fail", `Unexpected status ${r.status}.`);
  }

  // 2. Sign-ups: the site is public, so open sign-ups mean anyone can join the project. ──
  {
    const name = "New sign-ups are switched off";
    const r = await call(`${base}/auth/v1/settings`, { headers });
    let settings = null;
    try { settings = JSON.parse(r.text); } catch { /* handled below */ }
    if (settings && settings.disable_signup === true) add(name, "pass", "disable_signup is on.");
    else if (settings && settings.disable_signup === false) {
      add(name, "fail", "Anyone can create an account. Once your own account exists: Authentication > Sign In / Providers > turn off 'Allow new users to sign up'.");
    } else add(name, "warn", `Could not read the auth settings (status ${r.status}). Check this in the dashboard by hand.`);
  }

  // 3. Photo bucket: must not be readable by URL. ─────────────────────────────────────
  {
    const name = "Photo bucket is not publicly readable";
    const r = await call(`${base}/storage/v1/object/public/recipe-photos/verify-probe.jpg`, { headers });
    if (r.status === 200) add(name, "fail", "The recipe-photos bucket serves files publicly. Set it to private.");
    else if (r.status === 400 || r.status === 404) add(name, "pass", "A public URL is refused.");
    else add(name, "warn", `Unexpected status ${r.status}. Check the bucket is private in the dashboard.`);
  }

  // 4. Import function: must refuse anyone who is not a signed-in user. ────────────────
  {
    const name = "Link import refuses signed-out callers";
    const r = await call(`${base}/functions/v1/fetch-recipe-page`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    if (r.status === 401 || r.status === 403) add(name, "pass", `Refused with ${r.status}.`);
    else if (r.status === 404) add(name, "warn", "The function is not deployed, so importing from a link will not work. Pasting text still does.");
    else if (r.status === 200) add(name, "fail", "The function answered a signed-out request. It is an open proxy: it must verify the user (see supabase/functions/fetch-recipe-page/index.ts).");
    else add(name, "warn", `Unexpected status ${r.status}.`);
  }

  // 5. The published site. ────────────────────────────────────────────────────────────
  if (siteUrl) {
    const site = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
    const page = await call(site);
    if (page.status !== 200) {
      add("Site is published", "fail", `${site} returned ${page.status || "no response"}. Is Pages enabled, and is the repo public (or on a paid plan)?`);
    } else {
      add("Site is published", "pass", `${site} returned 200.`);

      const src = page.text.match(/<script[^>]+src="([^"]+\.js)"/i)?.[1];
      if (!src) {
        add("Site bundle points at this project", "warn", "Could not find the script in the page to inspect.");
      } else {
        const js = await call(new URL(src, site).href);
        const host = new URL(base).host;
        if (js.status !== 200) add("Site bundle points at this project", "warn", `Could not fetch the bundle (${js.status}).`);
        else {
          if (js.text.includes(host)) add("Site bundle points at this project", "pass", "The Supabase URL is baked in, so the repo variables were set at build time.");
          else add("Site bundle points at this project", "fail", "The bundle does not mention this project. It was built without VITE_SUPABASE_URL: set the repo variables, then re-run the deploy workflow.");

          // The publishable key is meant to be in here. A secret key must never be.
          const leak = js.text.match(/sb_secret_[A-Za-z0-9_-]{8,}|service_role/);
          if (leak) add("No secret key in the bundle", "fail", "The published bundle contains what looks like a secret/service_role key. Rotate it in Supabase immediately.");
          else add("No secret key in the bundle", "pass", "No secret-key markers found.");
        }
      }
    }
  }

  return results;
}

const SYMBOL = { pass: "PASS", fail: "FAIL", warn: "WARN" };

function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const siteArg = process.argv.indexOf("--site");
  const siteUrl = (siteArg > -1 ? process.argv[siteArg + 1] : undefined) ?? process.env.SITE_URL;

  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the VITE_ names also work).");
    process.exit(2);
  }
  // A key that starts with sb_secret_ or is the legacy service_role JWT must never be used
  // here: this script would be sending it to a URL it does not control the logging of.
  if (/^sb_secret_/.test(key)) {
    console.error("That is a SECRET key. Refusing to use it. This script only needs the publishable key.");
    process.exit(2);
  }

  verify({ url, key, siteUrl }).then((results) => {
    for (const r of results) console.log(`${SYMBOL[r.status]}  ${r.name}\n      ${r.detail}`);
    const failed = results.filter((r) => r.status === "fail").length;
    const warned = results.filter((r) => r.status === "warn").length;
    console.log(`\n${results.length - failed - warned} passed, ${failed} failed, ${warned} warnings`);
    process.exit(failed ? 1 : 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
