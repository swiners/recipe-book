import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl, GuardError, isBlockedIp, parseIpv6, parsePublicUrl,
} from "../supabase/functions/fetch-recipe-page/guard.ts";

const refused = (url: string) => assert.throws(() => parsePublicUrl(url), GuardError, url);
const accepted = (url: string) => assert.doesNotThrow(() => parsePublicUrl(url), url);

test("ordinary public recipe sites are allowed", () => {
  accepted("https://www.example.com/recipes/pasta");
  accepted("http://example.com/a?b=c#d");
  accepted("https://example.com:443/x");
  accepted("https://sub.domain.example.co.uk/");
  accepted("https://93.184.216.34/");
  accepted("https://[2606:2800:220:1:248:1893:25c8:1946]/");
});

test("non-http schemes, credentials and odd ports are refused", () => {
  for (const u of [
    "file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "javascript:alert(1)",
    "data:text/html,hi", "ws://example.com/",
    "https://user:pass@example.com/", "https://user@example.com/",
    "https://example.com:8080/", "http://example.com:22/", "http://example.com:6379/",
  ]) refused(u);
});

test("localhost, internal suffixes and single-label names are refused", () => {
  for (const u of [
    "http://localhost/", "http://LOCALHOST/", "http://localhost./", "http://foo.localhost/",
    "http://printer.local/", "http://db.internal/", "http://db.internal./", "http://nas.lan/",
    "http://router.home.arpa/", "http://intranet/", "http://metadata/",
  ]) refused(u);
});

test("IPv4 private, loopback, link-local and metadata ranges are refused", () => {
  for (const ip of [
    "0.0.0.0", "10.0.0.1", "10.255.255.255", "127.0.0.1", "127.255.255.254",
    "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.255",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
    refused(`http://${ip}/`);
  }
});

test("IPv4 just outside the blocked ranges is allowed", () => {
  for (const ip of ["172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "169.253.0.1", "193.0.0.1", "8.8.8.8", "223.255.255.255"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("alternative IPv4 spellings are normalised by URL and then refused", () => {
  for (const u of [
    "http://2130706433/", //          127.0.0.1 as one decimal number
    "http://0x7f000001/", //          hex
    "http://0x7f.0.0.1/", //          hex octet
    "http://017700000001/", //        octal
    "http://127.1/", //               short form
    "http://0/", //                   0.0.0.0
    "http://2852039166/", //          169.254.169.254 as decimal
    "http://0xa9.0xfe.0xa9.0xfe/", // 169.254.169.254 hex
  ]) refused(u);
});

test("userinfo tricks do not smuggle a blocked host past the check", () => {
  refused("http://example.com@127.0.0.1/"); //         real host is 127.0.0.1, and userinfo is refused anyway
  refused("http://127.0.0.1@example.com/"); //         userinfo refused
  refused("http://example.com%2f@127.0.0.1/");
});

test("IPv6 loopback, private, link-local and mapped addresses are refused", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1", "64:ff9b::169.254.169.254",
    "2001:db8::1", "2001::1", "2002:7f00:1::1", "::127.0.0.1", "0:0:0:0:0:0:0:1",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
    refused(`http://[${ip}]/`);
  }
});

test("IPv6 parser handles compression and rejects garbage", () => {
  assert.deepEqual(parseIpv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIpv6("2001:db8::ff00:42:8329"), [0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329]);
  assert.deepEqual(parseIpv6("::ffff:1.2.3.4"), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  for (const bad of ["", ":::", "1::2::3", "12345::1", "g::1", "1:2:3:4:5:6:7:8:9", "1:2:3", "::ffff:999.1.1.1", "example.com"]) {
    assert.equal(parseIpv6(bad), null, bad);
    assert.equal(isBlockedIp(bad), true, `unparseable "${bad}" is blocked, not allowed`);
  }
});

test("oversized or non-string input is a clean refusal, not a crash", () => {
  refused("https://example.com/" + "a".repeat(3000));
  refused("");
  refused("   ");
  refused("not a url");
  assert.throws(() => parsePublicUrl(undefined as unknown as string), GuardError);
  assert.throws(() => parsePublicUrl({} as unknown as string), GuardError);
});

const dns = (table: Record<string, string[] | Error>) => async (host: string) => {
  const hit = table[host];
  if (hit instanceof Error) throw hit;
  return hit ?? [];
};

test("assertPublicUrl resolves names and checks every address", async () => {
  const resolve = dns({
    "good.example.com": ["93.184.216.34"],
    "dual.example.com": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
    "evil.example.com": ["127.0.0.1"],
    "mixed.example.com": ["93.184.216.34", "10.0.0.5"],
    "mixed6.example.com": ["93.184.216.34", "fe80::1"],
    "metadata.example.com": ["169.254.169.254"],
    "empty.example.com": [],
    "broken.example.com": new Error("SERVFAIL"),
  });

  assert.equal((await assertPublicUrl("https://good.example.com/x", resolve)).hostname, "good.example.com");
  await assertPublicUrl("https://dual.example.com/", resolve);

  for (const host of ["evil", "mixed", "mixed6", "metadata"]) {
    await assert.rejects(assertPublicUrl(`https://${host}.example.com/`, resolve), (e: unknown) =>
      e instanceof GuardError && e.code === "blocked_host", host);
  }
  for (const host of ["empty", "broken", "unknown"]) {
    await assert.rejects(assertPublicUrl(`https://${host}.example.com/`, resolve), (e: unknown) =>
      e instanceof GuardError && e.code === "dns_failed", host);
  }
});

test("assertPublicUrl does not call DNS for IP literals, and still refuses blocked ones", async () => {
  let calls = 0;
  const resolve = async () => { calls++; return ["93.184.216.34"]; };
  await assertPublicUrl("https://93.184.216.34/", resolve);
  await assert.rejects(assertPublicUrl("http://127.0.0.1/", resolve), GuardError);
  assert.equal(calls, 0);
});

test("a redirect target is checked like any other URL", async () => {
  // The function re-runs assertPublicUrl on each hop, so a public page that redirects to
  // the metadata service is refused. This is the property being relied on.
  const resolve = dns({ "good.example.com": ["93.184.216.34"] });
  const hop1 = await assertPublicUrl("https://good.example.com/", resolve);
  const redirectedTo = new URL("http://169.254.169.254/latest/meta-data/", hop1).href;
  await assert.rejects(assertPublicUrl(redirectedTo, resolve), GuardError);
  const relative = new URL("/next", hop1).href;
  await assertPublicUrl(relative, resolve);
});
