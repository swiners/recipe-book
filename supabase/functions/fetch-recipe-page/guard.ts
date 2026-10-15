/* SSRF guard for the recipe-page fetcher.

   The function fetches a URL a user typed. That makes it a server-side request made on
   someone else's behalf, which is the textbook way to reach things the caller should not:
   cloud metadata endpoints (169.254.169.254), the platform's own internal network,
   localhost services. So before any request is made, and again after every redirect:

     1. the scheme must be http or https, on port 80 or 443, with no embedded credentials
     2. the host must be a real public name or a public IP, not "localhost" or an
        internal-looking suffix
     3. every address the name resolves to must be public

   Pure functions, no Deno APIs and no imports, so the unit tests run them under Node.
   DNS is injected as `resolve` for the same reason.

   Known limit, stated so nobody assumes otherwise: the name is resolved here and then
   resolved again by fetch(), so a hostile DNS server could answer differently the second
   time (DNS rebinding). Deno's fetch cannot be pinned to the address we checked. What
   contains it is that the function holds no secrets, returns only extracted JSON-LD, and
   runs in Supabase's sandbox. Do not add secrets to this function without fixing that. */

export class GuardError extends Error {
  // An explicit field, not a constructor parameter property: that syntax cannot be
  // stripped by Node (which the tests rely on) or compiled under erasableSyntaxOnly.
  code: "bad_url" | "blocked_host" | "dns_failed";
  constructor(code: "bad_url" | "blocked_host" | "dns_failed", message: string) {
    super(message);
    this.code = code;
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443"]);

/* Names that are never public, whatever they resolve to. A single-label name ("intranet")
   is also refused: public hosts always have a dot. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".corp", ".intranet"];

export function parseIpv4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

export function isBlockedIpv4(p: number[]): boolean {
  const [a, b, c] = p;
  return (
    a === 0 || //                              "this network"
    a === 10 || //                             private
    a === 127 || //                            loopback
    (a === 100 && b >= 64 && b <= 127) || //   carrier-grade NAT
    (a === 169 && b === 254) || //             link-local, includes cloud metadata
    (a === 172 && b >= 16 && b <= 31) || //    private
    (a === 192 && b === 0 && c === 0) || //    IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || //    documentation
    (a === 192 && b === 168) || //             private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || //  documentation
    a >= 224 //                                multicast, reserved, broadcast
  );
}

/** Expand an IPv6 literal to eight 16-bit groups. Null if it is not valid IPv6. */
export function parseIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;

  // Trailing dotted-quad ("::ffff:1.2.3.4") becomes two groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    s = s.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

export function isBlockedIpv6(g: number[]): boolean {
  const embeddedV4 = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96): the IPv4 rules decide.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedIpv4(embeddedV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIpv4(embeddedV4(g[6], g[7]));

  // Allowlist, not blocklist: only global unicast (2000::/3) can be a public host. That
  // alone rules out ::, ::1, fc00::/7, fe80::/10, ff00::/8 and the deprecated ::/96.
  if (g[0] < 0x2000 || g[0] > 0x3fff) return true;

  // Carve-outs inside 2000::/3 that are not ordinary public hosts.
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo
  if (g[0] === 0x2002) return true; //                    6to4: embeds an IPv4 we would have to re-check
  return false;
}

/** True for any address that must not be fetched. Unparseable input is blocked. */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(ip);
  return v6 ? isBlockedIpv6(v6) : true;
}

const isIpLiteral = (host: string) => parseIpv4(host) !== null || host.includes(":");

/** Validate the URL itself. Throws GuardError. Does not touch the network. */
export function parsePublicUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new GuardError("bad_url", "That is not a usable web address.");
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new GuardError("bad_url", "That is not a usable web address.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GuardError("bad_url", "Only http and https addresses can be imported.");
  }
  if (url.username || url.password) {
    throw new GuardError("bad_url", "Addresses with a username or password are not allowed.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new GuardError("bad_url", "Only the standard web ports are allowed.");
  }

  // URL normalises hex/octal/decimal IPv4 ("0x7f.1", "2130706433") to dotted form, and
  // brackets IPv6, so by here an IP literal is in a shape the parsers above understand.
  // A trailing dot ("localhost.", "metadata.internal.") is the same name and is valid DNS,
  // so it is stripped before the name rules run rather than slipping past them.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

  if (isIpLiteral(host)) {
    if (isBlockedIp(host)) throw new GuardError("blocked_host", "That address is not a public website.");
    return url;
  }

  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new GuardError("blocked_host", "That address is not a public website.");
  }
  return url;
}

export type Resolver = (host: string) => Promise<string[]>;

/** Validate the URL and that every address its name resolves to is public. */
export async function assertPublicUrl(raw: string, resolve: Resolver): Promise<URL> {
  const url = parsePublicUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return url; // already checked, nothing to resolve

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new GuardError("dns_failed", "Could not find that website.");
  }
  if (addresses.length === 0) throw new GuardError("dns_failed", "Could not find that website.");

  // Every address, not the first: a name can return one public and one private record.
  if (addresses.some(isBlockedIp)) throw new GuardError("blocked_host", "That address is not a public website.");
  return url;
}
