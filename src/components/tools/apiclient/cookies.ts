// Cookie jar (Bruno-style): captures Set-Cookie from responses, persists them,
// and auto-attaches matching cookies to outgoing requests by domain/path.
//
// This is a pragmatic subset of RFC 6265 — enough to keep a login session alive
// across requests. On the desktop (Tauri HTTP) build the server's Set-Cookie is
// readable so capture works fully; browsers hide Set-Cookie from fetch, so the
// web build can still send manually-managed cookies but can't auto-capture.

export interface Cookie {
  name: string;
  value: string;
  domain: string;       // host, without any leading dot
  path: string;         // default '/'
  expires?: number;     // epoch ms; undefined = session cookie
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  hostOnly?: boolean;   // true when no Domain attribute → exact-host match only
}

// Stable identity of a cookie for upsert/replace (RFC 6265 §5.3).
// Ký tự phân tách là NUL — viết bằng escape `\u0000`, KHÔNG nhúng byte 00
// thật vào file: một byte NUL khiến git/grep/diff coi cả file là nhị phân
// (`Binary files differ`), nên mọi review và tìm kiếm trong file này mù hẳn.
const keyOf = (c: Cookie) => `${c.domain}\u0000${c.path}\u0000${c.name}`;

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
function pathOf(url: string): string {
  try {
    const p = new URL(url).pathname || '/';
    // Default-path: everything up to and including the last '/'.
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  } catch { return '/'; }
}
function isSecure(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

// Parse one Set-Cookie header value into a Cookie, filling defaults from the
// request URL. Returns null if it has no name=value pair.
export function parseSetCookie(raw: string, url: string): Cookie | null {
  const parts = raw.split(';');
  const first = parts.shift();
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq === -1) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  // No Domain attribute → host-only cookie (RFC 6265 §5.3): it must only be
  // sent back to the exact origin host, never to subdomains.
  const host = hostOf(url);
  const cookie: Cookie = { name, value, domain: host, path: pathOf(url), hostOnly: true };
  let maxAge: number | null = null;

  for (const attr of parts) {
    const idx = attr.indexOf('=');
    const k = (idx === -1 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const v = idx === -1 ? '' : attr.slice(idx + 1).trim();
    switch (k) {
      case 'domain': {
        const d = v.replace(/^\./, '').toLowerCase();
        // RFC 6265 §5.3 step 6: a Domain attribute that does not domain-match
        // the host the response came from is REJECTED — the cookie stays
        // host-only. Without this check any host you send one request to can
        // plant a cookie for any other host, and the jar then attaches it to
        // your next request there: `Set-Cookie: session=…; Domain=api.bank.example`
        // answered by an unrelated server was stored and sent on verbatim.
        // Browsers have always enforced this; the jar did not.
        //
        // Not a public-suffix check: `Domain=co.uk` from `a.co.uk` still
        // passes here, which needs the PSL to catch and is out of scope for
        // this jar. The cheap half of it is covered — a single-label domain
        // (`Domain=com`) is only accepted when it *is* the host, so
        // `localhost` keeps working and `com` does not.
        if (d && domainMatchesHost(host, d)) { cookie.domain = d; cookie.hostOnly = false; }
        break;
      }
      case 'path': cookie.path = v || '/'; break;
      case 'expires': { const t = Date.parse(v); if (!Number.isNaN(t)) cookie.expires = t; break; }
      case 'max-age': { const n = Number(v); if (!Number.isNaN(n)) maxAge = n; break; }
      case 'secure': cookie.secure = true; break;
      case 'httponly': cookie.httpOnly = true; break;
      case 'samesite': cookie.sameSite = v; break;
    }
  }
  // Max-Age takes precedence over Expires (RFC 6265 §5.2.2).
  if (maxAge !== null) cookie.expires = Date.now() + maxAge * 1000;
  return cookie;
}

// Whether `host` may be given a cookie scoped to `domain` — the same
// relation `domainMatches` uses when sending, applied at capture time to the
// Domain attribute. Exported for its own test.
export function domainMatchesHost(host: string, domain: string): boolean {
  if (!host || !domain) return false;
  if (host === domain) return true;
  // A domain with no dot can only ever be the host itself (see the Domain
  // case above) — this is what keeps `Domain=com` out of the jar.
  if (!domain.includes('.')) return false;
  return host.endsWith(`.${domain}`);
}

const expired = (c: Cookie, now: number) => c.expires !== undefined && c.expires <= now;

// Apply a batch of Set-Cookie strings from a response at `url` to the jar.
// Upserts by (domain, path, name); a cookie that arrives already-expired (or
// Max-Age<=0) deletes the matching entry. Returns a new jar array.
export function applySetCookies(jar: Cookie[], raws: string[], url: string): Cookie[] {
  const now = Date.now();
  const map = new Map(jar.map((c) => [keyOf(c), c]));
  for (const raw of raws) {
    const c = parseSetCookie(raw, url);
    if (!c) continue;
    if (expired(c, now)) map.delete(keyOf(c));
    else map.set(keyOf(c), c);
  }
  // Drop anything that has since expired while we're here.
  return [...map.values()].filter((c) => !expired(c, now));
}

function domainMatches(host: string, cookie: Cookie): boolean {
  if (host === cookie.domain) return true;
  // Host-only cookies (no Domain attribute) never match subdomains.
  if (cookie.hostOnly) return false;
  return host.endsWith(`.${cookie.domain}`);
}
function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true;
  if (reqPath.startsWith(cookiePath)) {
    return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
  }
  return false;
}

// Cookies from the jar that apply to a request URL, longest-path first (the
// order browsers use).
export function cookiesFor(jar: Cookie[], url: string): Cookie[] {
  const host = hostOf(url);
  const path = (() => { try { return new URL(url).pathname || '/'; } catch { return '/'; } })();
  const secure = isSecure(url);
  const now = Date.now();
  return jar
    .filter((c) =>
      !expired(c, now) &&
      domainMatches(host, c) &&
      pathMatches(path, c.path) &&
      (!c.secure || secure))
    .sort((a, b) => b.path.length - a.path.length);
}

// Serialize the matching cookies into a Cookie request-header value.
export function cookieHeader(jar: Cookie[], url: string): string {
  return cookiesFor(jar, url).map((c) => `${c.name}=${c.value}`).join('; ');
}

// Group a jar by domain for display in the cookie manager.
export function groupByDomain(jar: Cookie[]): [string, Cookie[]][] {
  const map = new Map<string, Cookie[]>();
  for (const c of jar) {
    const list = map.get(c.domain) ?? [];
    list.push(c);
    map.set(c.domain, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
