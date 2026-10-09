import { test } from "node:test";
import assert from "node:assert/strict";
import { verify } from "../scripts/verify-deploy.mjs";

const URL_ = "https://abcdefgh.supabase.co";
const KEY = "sb_publishable_test_not_real";
const SITE = "https://example.github.io/sam-recipes/";

type Route = { status: number; body?: string };
/** A fake fetch keyed on "METHOD url-suffix". No network, no sockets. */
function fakeFetch(routes: Record<string, Route>, seen: { url: string; init?: RequestInit }[] = []) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const method = init?.method ?? "GET";
    // A route key is either "POST /path" (method-specific) or a bare "/path" (GET).
    const hit = Object.entries(routes).find(([k]) => {
      const [m, ...rest] = k.split(" ");
      return /^[A-Z]+$/.test(m) && rest.length ? m === method && url.endsWith(rest.join(" ")) : method === "GET" && url.endsWith(k);
    });
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(hit[1].body ?? "", { status: hit[1].status });
  }) as typeof fetch;
}

const GOOD: Record<string, Route> = {
  "/rest/v1/recipes?select=id&limit=1": { status: 200, body: "[]" },
  "/auth/v1/settings": { status: 200, body: JSON.stringify({ disable_signup: true }) },
  "/storage/v1/object/public/recipe-photos/verify-probe.jpg": { status: 400, body: '{"message":"Bucket not found"}' },
  "POST /functions/v1/fetch-recipe-page": { status: 401, body: '{"error":"Sign in first."}' },
  "sam-recipes/": { status: 200, body: '<html><script type="module" src="/sam-recipes/assets/index-abc.js"></script><div id="root"></div></html>' },
  "/sam-recipes/assets/index-abc.js": { status: 200, body: 'const u="https://abcdefgh.supabase.co";' },
};
const by = (rs: Awaited<ReturnType<typeof verify>>) => Object.fromEntries(rs.map((r) => [r.name, r.status]));

test("a correctly locked-down project passes every check", async () => {
  const rs = await verify({ url: URL_, key: KEY, siteUrl: SITE, fetchImpl: fakeFetch(GOOD) });
  assert.deepEqual(rs.filter((r) => r.status !== "pass"), []);
  assert.equal(rs.length, 7);
});

test("RLS leak: a signed-out request that returns rows FAILS", async () => {
  const rs = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "/rest/v1/recipes?select=id&limit=1": { status: 200, body: '[{"id":"x"}]' } }) });
  assert.equal(by(rs)["Signed-out visitors cannot read recipes"], "fail");
});

test("RLS: refusal (401/403) or an empty list both pass; missing table fails", async () => {
  for (const status of [401, 403]) {
    const rs = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "/rest/v1/recipes?select=id&limit=1": { status } }) });
    assert.equal(by(rs)["Signed-out visitors cannot read recipes"], "pass", String(status));
  }
  const missing = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "/rest/v1/recipes?select=id&limit=1": { status: 404 } }) });
  assert.equal(by(missing)["Signed-out visitors cannot read recipes"], "fail");
});

test("open sign-ups FAIL, unreadable settings only WARN", async () => {
  const open = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "/auth/v1/settings": { status: 200, body: '{"disable_signup":false}' } }) });
  assert.equal(by(open)["New sign-ups are switched off"], "fail");
  const garbled = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "/auth/v1/settings": { status: 500, body: "oops" } }) });
  assert.equal(by(garbled)["New sign-ups are switched off"], "warn");
});

test("a public photo bucket FAILS", async () => {
  const rs = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "/storage/v1/object/public/recipe-photos/verify-probe.jpg": { status: 200, body: "img" } }) });
  assert.equal(by(rs)["Photo bucket is not publicly readable"], "fail");
});

test("an open import function FAILS, a missing one only warns, refusal passes", async () => {
  const open = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "POST /functions/v1/fetch-recipe-page": { status: 200, body: '{"blocks":[]}' } }) });
  assert.equal(by(open)["Link import refuses signed-out callers"], "fail");
  const missing = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "POST /functions/v1/fetch-recipe-page": { status: 404 } }) });
  assert.equal(by(missing)["Link import refuses signed-out callers"], "warn");
  const refused = await verify({ url: URL_, key: KEY, fetchImpl: fakeFetch({ ...GOOD, "POST /functions/v1/fetch-recipe-page": { status: 403 } }) });
  assert.equal(by(refused)["Link import refuses signed-out callers"], "pass");
});

test("the exact bug this repo shipped with: a site built without the variables FAILS", async () => {
  const rs = await verify({
    url: URL_, key: KEY, siteUrl: SITE,
    fetchImpl: fakeFetch({ ...GOOD, "/sam-recipes/assets/index-abc.js": { status: 200, body: "const u=undefined;" } }),
  });
  assert.equal(by(rs)["Site bundle points at this project"], "fail");
});

test("a secret key inside the published bundle FAILS", async () => {
  for (const leaked of ["sb_secret_abcdefghijklmnop", '"role":"service_role"']) {
    const rs = await verify({
      url: URL_, key: KEY, siteUrl: SITE,
      fetchImpl: fakeFetch({ ...GOOD, "/sam-recipes/assets/index-abc.js": { status: 200, body: `const u="https://abcdefgh.supabase.co";const k="${leaked}";` } }),
    });
    assert.equal(by(rs)["No secret key in the bundle"], "fail", leaked);
  }
});

test("supabase-js's own key-prefix check is not mistaken for a leaked key", async () => {
  // Every real bundle contains this: the library refuses secret keys in a browser by
  // testing for the prefix. A prefix with no token after it is not a key.
  const libraryCheck = 'Sa=e=>e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`),Ca=`sb_temp_`';
  const rs = await verify({
    url: URL_, key: KEY, siteUrl: SITE,
    fetchImpl: fakeFetch({ ...GOOD, "/sam-recipes/assets/index-abc.js": { status: 200, body: `const u="https://abcdefgh.supabase.co";${libraryCheck}` } }),
  });
  assert.equal(by(rs)["No secret key in the bundle"], "pass");
});

test("an unpublished site FAILS", async () => {
  const rs = await verify({ url: URL_, key: KEY, siteUrl: SITE, fetchImpl: fakeFetch({ ...GOOD, "sam-recipes/": { status: 404 } }) });
  assert.equal(by(rs)["Site is published"], "fail");
});

test("an unreachable project fails with a useful message and does not throw", async () => {
  const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const rs = await verify({ url: URL_, key: KEY, fetchImpl: down });
  assert.equal(by(rs)["Signed-out visitors cannot read recipes"], "fail");
  assert.match(rs[0].detail, /Could not reach the project/);
});

test("every request is signed out: only the publishable key is sent, and nothing is written", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  await verify({ url: URL_, key: KEY, siteUrl: SITE, fetchImpl: fakeFetch(GOOD, seen) });
  for (const { url, init } of seen) {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.startsWith(URL_)) assert.equal(headers.apikey, KEY, url);
    const auth = headers.Authorization;
    assert.ok(!auth || auth === `Bearer ${KEY}`, `no user token is ever sent: ${url}`);
    // The only POST is the function probe, which carries a fixed harmless URL.
    if ((init?.method ?? "GET") !== "GET") assert.ok(url.endsWith("/functions/v1/fetch-recipe-page"), url);
  }
  // The site is fetched without the key (it is a different origin and needs none).
  const siteCall = seen.find((s) => s.url === SITE)!;
  assert.equal(((siteCall.init?.headers ?? {}) as Record<string, string>).apikey, undefined);
});

test("a trailing slash on the URL is tolerated", async () => {
  const rs = await verify({ url: `${URL_}/`, key: KEY, fetchImpl: fakeFetch(GOOD) });
  assert.equal(by(rs)["Signed-out visitors cannot read recipes"], "pass");
});
