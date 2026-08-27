// Request execution engine.
//
// In the Tauri desktop app we route through the HTTP plugin so the request is
// made from Rust — no browser `Origin` header, no CORS preflight — letting the
// tool hit any API like Postman/Bruno would. On the web build we fall back to
// the standard `fetch` (subject to the target's CORS policy). Requests only ever
// fire when the user clicks Send.

import { isTauri } from '@/lib/platform';
import type { ApiRequest, ApiResponse, KeyValue, OAuth2Auth, VarMap } from './types';
import { newKeyValue } from './types';
import { substituteVars } from './vars';
import { buildDigestHeader, parseDigestChallenge } from './digest';
import { type Cookie, cookieHeader } from './cookies';


async function netFetch(input: string, init: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

// ─── variable substitution ──────────────────────────────────────────────────

// Lives in vars.ts (shared with the scripting sandbox); re-exported here so the
// long-standing `from './request'` import sites keep working.
export { substituteVars };

const enabledPairs = (list: KeyValue[]): [string, string][] =>
  list.filter((kv) => kv.enabled && kv.key.trim()).map((kv) => [kv.key, kv.value]);

type Sub = (s: string) => string;

// The API-key auth entry, when placed as a query param, isn't part of
// `req.params` — buildUrl below folds it into the outgoing query string
// silently. Exposed so the Params tab can show it as a derived, read-only row
// instead of leaving it invisible until send time.
export function authQueryParam(req: ApiRequest): { key: string; value: string } | null {
  const { auth } = req;
  if (auth.type === 'apikey' && auth.apiKey.placement === 'query' && auth.apiKey.key.trim()) {
    return { key: auth.apiKey.key, value: auth.apiKey.value };
  }
  return null;
}

// Build the final URL: substitute vars, then append enabled query params.
// When the request's URL-encoding setting is off, params are appended raw so the
// user keeps full control of the query string (Bruno's "URL Encoding" toggle).
export function buildUrl(req: ApiRequest, sub: Sub): string {
  let base = sub(req.url).trim();

  // Substitute :placeholders in the path (only after a '/', so ports like :8080
  // are untouched). Encoding follows the URL-encoding setting.
  const pathMap: Record<string, string> = {};
  for (const p of req.pathParams ?? []) if (p.enabled && p.key) pathMap[p.key] = sub(p.value);
  const enc = (v: string) => (req.settings?.encodeUrl === false ? v : encodeURIComponent(v));
  base = base.replace(/(\/):([A-Za-z_]\w*)/g, (m, slash, name) => (name in pathMap ? slash + enc(pathMap[name]) : m));

  const params = enabledPairs(req.params).map(
    ([k, v]) => [sub(k), sub(v)] as [string, string],
  );
  if (req.auth.type === 'apikey' && req.auth.apiKey.placement === 'query' && req.auth.apiKey.key.trim()) {
    params.push([sub(req.auth.apiKey.key), sub(req.auth.apiKey.value)]);
  }
  // No managed params → leave the URL (and its own query) untouched.
  if (!params.length) return base;

  // The params table mirrors the query string, so build the query *only* from
  // the params (dropping the URL's own query) to avoid duplicating them.
  const head = base.split('#')[0].split('?')[0];

  if (req.settings?.encodeUrl === false) {
    return `${head}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
  }
  const search = new URLSearchParams();
  for (const [k, v] of params) search.append(k, v);
  return `${head}?${search.toString()}`;
}

// Assemble headers from the collection/folder chain (outer→inner), the
// request's own headers list, auth, and the body content-type. Later sources
// override an earlier one of the same name (case-insensitively, since HTTP
// header names aren't case-sensitive) — matching Bruno's collection → folder →
// request precedence.
function buildHeaders(req: ApiRequest, sub: Sub, inheritedHeaders: KeyValue[][] = []): Record<string, string> {
  const headers: Record<string, string> = {};
  const keyByLower: Record<string, string> = {};
  const setHeader = (k: string, v: string) => {
    if (!k) return;
    const lower = k.toLowerCase();
    const prevKey = keyByLower[lower];
    if (prevKey && prevKey !== k) delete headers[prevKey];
    headers[k] = v;
    keyByLower[lower] = k;
  };

  for (const list of inheritedHeaders) {
    for (const [k, v] of enabledPairs(list)) setHeader(sub(k), sub(v));
  }
  for (const [k, v] of enabledPairs(req.headers)) setHeader(sub(k), sub(v));

  if (req.auth.type === 'bearer' && req.auth.token.trim()) {
    setHeader('Authorization', `Bearer ${sub(req.auth.token).trim()}`);
  } else if (req.auth.type === 'basic') {
    const user = sub(req.auth.username);
    const pass = sub(req.auth.password);
    setHeader('Authorization', `Basic ${btoa(`${user}:${pass}`)}`);
  } else if (req.auth.type === 'apikey' && req.auth.apiKey.placement === 'header' && req.auth.apiKey.key.trim()) {
    setHeader(sub(req.auth.apiKey.key), sub(req.auth.apiKey.value));
  }

  const hasContentType = 'content-type' in keyByLower;
  if (!hasContentType && req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = BODY_CONTENT_TYPE[req.body.mode];
    // multipart is intentionally omitted so fetch can set the boundary itself.
    if (ct) setHeader('Content-Type', ct === 'file' ? (req.body.fileType || 'application/octet-stream') : ct);
  }
  return headers;
}

// Content-type per raw/form body mode. `null` means "don't set" (e.g. multipart,
// where the browser must add the boundary). 'file' is resolved at call site.
const BODY_CONTENT_TYPE: Record<string, string | null> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  sparql: 'application/sparql-query',
  graphql: 'application/json',
  urlencoded: 'application/x-www-form-urlencoded',
  multipart: null,
  file: 'file',
  none: null,
};

// Decode base64 file content into a Blob for upload.
function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

// Build the request body. Returns undefined for methods/modes without a body.
function buildBody(req: ApiRequest, sub: Sub): BodyInit | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  switch (req.body.mode) {
    case 'json':
    case 'xml':
    case 'text':
    case 'sparql':
      return req.body.raw ? sub(req.body.raw) : undefined;
    case 'graphql': {
      const gql = req.body.graphql ?? { query: '', variables: '' };
      let variables: unknown = {};
      try { variables = gql.variables.trim() ? JSON.parse(sub(gql.variables)) : {}; } catch { variables = {}; }
      return JSON.stringify({ query: sub(gql.query), variables });
    }
    case 'urlencoded': {
      const p = new URLSearchParams();
      for (const [k, v] of enabledPairs(req.body.form)) p.append(sub(k), sub(v));
      return p.toString();
    }
    case 'multipart': {
      const fd = new FormData();
      for (const f of req.body.form) {
        if (!f.enabled || !f.key.trim()) continue;
        const key = sub(f.key);
        if (f.kind === 'file' && f.fileContent) {
          fd.append(key, base64ToBlob(f.fileContent, f.contentType || f.fileType || ''), f.fileName);
        } else if (f.contentType) {
          // Wrap text in a Blob so the part carries the explicit Content-Type.
          fd.append(key, new Blob([sub(f.value)], { type: f.contentType }));
        } else {
          fd.append(key, sub(f.value));
        }
      }
      return fd;
    }
    case 'file':
      return req.body.fileContent ? base64ToBlob(req.body.fileContent, req.body.fileType ?? '') : undefined;
    default:
      return undefined;
  }
}

// ─── OAuth2 ─────────────────────────────────────────────────────────────────

// Access tokens are cached in memory (never persisted) for the lifetime of the
// app session, keyed by the resolved grant parameters. Without this every send
// pays for a full token round-trip, which both slows runs down and hammers the
// authorization server. Tokens expire 30 s early to avoid edge-of-validity 401s.
interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();
const TOKEN_SKEW_MS = 30_000;

// Exposed so the UI can offer a "forget cached tokens" action.
export function clearOAuthTokenCache(): void {
  tokenCache.clear();
}

// Fetch an OAuth2 access token (client-credentials or password grant).
async function fetchOAuthToken(o: OAuth2Auth, sub: Sub, signal?: AbortSignal): Promise<string> {
  const url = sub(o.tokenUrl).trim();
  if (!url) throw new Error('OAuth2: token URL is required');

  const clientId = sub(o.clientId);
  const clientSecret = sub(o.clientSecret);
  const scope = sub(o.scope);
  const username = sub(o.username);
  const cacheKey = JSON.stringify([url, o.grantType, clientId, clientSecret, scope, username]);
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const form = new URLSearchParams();
  form.set('grant_type', o.grantType);
  if (clientId) form.set('client_id', clientId);
  if (clientSecret) form.set('client_secret', clientSecret);
  if (scope) form.set('scope', scope);
  if (o.grantType === 'password') { form.set('username', username); form.set('password', sub(o.password)); }

  const res = await netFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
    signal,
  });
  const raw = await res.text();
  let json: { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`OAuth2 token request failed (${res.status}): ${raw.slice(0, 200) || res.statusText}`);
  }
  if (!json.access_token) {
    throw new Error(`OAuth2 token request failed: ${json.error_description || json.error || res.status}`);
  }
  // `expires_in` is seconds; fall back to a short cache window when absent.
  const ttlMs = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 60_000;
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_SKEW_MS) });
  return json.access_token;
}

// ─── response decoding ──────────────────────────────────────────────────────

// Content types whose bytes must not be round-tripped through a text decoder —
// doing so replaces every invalid UTF-8 sequence with U+FFFD and destroys the
// payload (previously this silently corrupted image previews and downloads).
const BINARY_CONTENT_TYPE =
  /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|x-tar|x-7z|x-rar|wasm|vnd\.(ms-|openxmlformats))/i;

// Above this size we skip the base64 copy: it would double the memory footprint
// of an already-huge payload for no practical benefit in the viewer.
const MAX_BASE64_BYTES = 16 * 1024 * 1024;

function isBinaryPayload(contentType: string, bytes: Uint8Array): boolean {
  if (BINARY_CONTENT_TYPE.test(contentType)) return true;
  if (/text\/|json|xml|javascript|ecmascript|csv|x-www-form-urlencoded|graphql/i.test(contentType)) return false;
  // Unlabelled payload: a NUL byte in the first KB means it isn't text.
  const probe = bytes.subarray(0, 1024);
  return probe.includes(0);
}

// Chunked so a multi-MB body doesn't blow the argument limit of fromCharCode.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function sendRequest(
  req: ApiRequest,
  vars: VarMap,
  signal?: AbortSignal,
  cookieJar: Cookie[] = [],
  inheritedHeaders: KeyValue[][] = [],
): Promise<ApiResponse> {
  const sub: Sub = (s) => substituteVars(s, vars);
  const url = buildUrl(req, sub);
  if (!url) throw new Error('Enter a request URL');
  // Default to http:// if the user omitted the scheme.
  const finalUrl = /^https?:\/\//i.test(url) ? url : `http://${url}`;

  // A per-request timeout aborts the send; merge it with the caller's signal.
  const timeout = req.settings?.timeout ?? 0;
  const timeoutCtl = timeout > 0 ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Detach the bridge listener once the send finishes, so a long-lived caller
  // signal doesn't accumulate one listener per request.
  let detachAbortBridge = () => {};
  if (timeoutCtl) {
    timer = setTimeout(() => timeoutCtl.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
    const forward = () => timeoutCtl.abort();
    signal?.addEventListener('abort', forward, { once: true });
    detachAbortBridge = () => signal?.removeEventListener('abort', forward);
  }
  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    detachAbortBridge();
  };

  const reqHeaders = buildHeaders(req, sub, inheritedHeaders);
  // OAuth2: fetch an access token first, then send the request as Bearer.
  if (req.auth.type === 'oauth2') {
    reqHeaders['Authorization'] = `Bearer ${await fetchOAuthToken(req.auth.oauth2, sub, timeoutCtl ? timeoutCtl.signal : signal)}`;
  }

  // Auto-attach jar cookies unless the request sets its own Cookie header.
  if (cookieJar.length && !Object.keys(reqHeaders).some((h) => h.toLowerCase() === 'cookie')) {
    const header = cookieHeader(cookieJar, finalUrl);
    if (header) reqHeaders['Cookie'] = header;
  }

  const init: RequestInit & { maxRedirections?: number } = {
    method: req.method,
    headers: reqHeaders,
    signal: timeoutCtl ? timeoutCtl.signal : signal,
    redirect: req.settings?.followRedirects === false ? 'manual' : 'follow',
  };
  // Tauri's HTTP plugin honours `maxRedirections`; harmless on web fetch.
  if (req.settings?.followRedirects !== false) init.maxRedirections = req.settings?.maxRedirects ?? 5;
  const body = buildBody(req, sub);
  if (body !== undefined) init.body = body;

  const start = performance.now();
  let res: Response;
  let bytes: Uint8Array;
  let headersAt: number;
  try {
    res = await netFetch(finalUrl, init);
    // Digest auth: the first send is unauthenticated; on a 401 challenge,
    // compute the Authorization header and resend once.
    if (req.auth.type === 'digest' && res.status === 401) {
      const challenge = parseDigestChallenge(res.headers.get('www-authenticate') ?? '');
      const user = sub(req.auth.username);
      if (challenge && user) {
        const u = new URL(finalUrl);
        const header = buildDigestHeader({
          username: user,
          password: sub(req.auth.password),
          method: req.method,
          uri: u.pathname + u.search,
          challenge,
        });
        const retryInit: typeof init = { ...init, headers: { ...reqHeaders, Authorization: header } };
        const retryBody = buildBody(req, sub);
        if (retryBody !== undefined) retryInit.body = retryBody;
        res = await netFetch(finalUrl, retryInit);
      }
    }
    headersAt = performance.now();
    // Read the raw bytes rather than res.text(): a text decode would replace
    // every invalid UTF-8 sequence in a binary payload with U+FFFD, so images
    // and downloads could never be recovered afterwards. The timeout stays
    // armed across the download — a server that stalls mid-body must still hit it.
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if ((e as Error).name === 'TimeoutError' || (timeoutCtl?.signal.aborted && !signal?.aborted)) {
      throw new Error(`Request timed out after ${timeout} ms`);
    }
    throw e;
  } finally {
    clearTimers();
  }
  const doneAt = performance.now();
  const timeMs = Math.round(doneAt - start);
  const timings = {
    ttfbMs: Math.round(headersAt - start),
    downloadMs: Math.round(doneAt - headersAt),
  };

  const headers: [string, string][] = [];
  res.headers.forEach((value, key) => headers.push([key, value]));

  // Capture Set-Cookie. getSetCookie() returns them un-collapsed (preferred);
  // fall back to the single combined header otherwise.
  const hdrs = res.headers as Headers & { getSetCookie?: () => string[] };
  let setCookies: string[] | undefined;
  if (typeof hdrs.getSetCookie === 'function') {
    const list = hdrs.getSetCookie();
    if (list.length) setCookies = list;
  } else {
    const sc = res.headers.get('set-cookie');
    if (sc) setCookies = [sc];
  }

  const contentType = res.headers.get('content-type') ?? '';
  const binary = isBinaryPayload(contentType, bytes);
  // The decoded byte count is the truth: content-length may describe the
  // compressed transfer, which under-reports what the viewer actually shows.
  const sizeBytes = bytes.byteLength;
  const text = new TextDecoder('utf-8').decode(bytes);

  return {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    headers,
    body: text,
    contentType,
    timeMs,
    timings,
    sizeBytes,
    url: res.url || finalUrl,
    setCookies,
    binary,
    bodyBase64: binary && bytes.byteLength <= MAX_BASE64_BYTES ? bytesToBase64(bytes) : undefined,
  };
}

// ─── resolved request (for code generation) ───────────────────────────────────

export type ResolvedBody =
  | { type: 'none' }
  | { type: 'raw'; text: string; contentType: string }
  | { type: 'urlencoded'; fields: [string, string][] }
  | { type: 'multipart'; fields: { key: string; value?: string; file?: string }[] }
  | { type: 'file'; fileName?: string };

export interface ResolvedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: ResolvedBody;
}

// The Content-Type a body mode implies, for display in generated code. Unlike the
// send path this also labels multipart, matching how Bruno renders code snippets.
const DISPLAY_CONTENT_TYPE: Record<string, string | null> = {
  json: 'application/json', xml: 'application/xml', text: 'text/plain',
  sparql: 'application/sparql-query', graphql: 'application/json', urlencoded: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data', none: null, file: null,
};

function resolveBody(req: ApiRequest, sub: Sub): ResolvedBody {
  const b = req.body;
  switch (b.mode) {
    case 'json': case 'xml': case 'text': case 'sparql':
      return b.raw ? { type: 'raw', text: sub(b.raw), contentType: DISPLAY_CONTENT_TYPE[b.mode] ?? 'text/plain' } : { type: 'none' };
    case 'graphql': {
      const gql = b.graphql ?? { query: '', variables: '' };
      let variables: unknown = {};
      try { variables = gql.variables.trim() ? JSON.parse(sub(gql.variables)) : {}; } catch { variables = {}; }
      return { type: 'raw', text: JSON.stringify({ query: sub(gql.query), variables }, null, 2), contentType: 'application/json' };
    }
    case 'urlencoded':
      return { type: 'urlencoded', fields: enabledPairs(b.form).map(([k, v]) => [sub(k), sub(v)]) };
    case 'multipart':
      return {
        type: 'multipart',
        fields: b.form.filter((f) => f.enabled && f.key.trim()).map((f) =>
          f.kind === 'file' && f.fileName ? { key: sub(f.key), file: f.fileName } : { key: sub(f.key), value: sub(f.value) },
        ),
      };
    case 'file':
      return { type: 'file', fileName: b.fileName };
    default:
      return { type: 'none' };
  }
}

// Resolve a request into the concrete method/url/headers/body used to render a
// code snippet. `interpolate` toggles {{var}} substitution (Bruno's checkbox).
export function resolveRequest(
  req: ApiRequest, vars: VarMap, interpolate: boolean, inheritedHeaders: KeyValue[][] = [],
): ResolvedRequest {
  const sub: Sub = interpolate ? (s) => substituteVars(s, vars) : (s) => s;
  const url = buildUrl(req, sub) || sub(req.url);
  const finalUrl = url && !/^https?:\/\//i.test(url) ? `http://${url}` : url;

  const headers: [string, string][] = Object.entries(buildHeaders(req, sub, inheritedHeaders));
  if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    const ct = DISPLAY_CONTENT_TYPE[req.body.mode] ?? (req.body.mode === 'file' ? req.body.fileType : null);
    if (ct) headers.push(['Content-Type', ct]);
  }
  return { method: req.method, url: finalUrl, headers, body: resolveBody(req, sub) };
}

export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// ─── URL ⇄ query-params sync (Postman/Bruno) ──────────────────────────────────
// Kept as raw string ops (no URL/URLSearchParams) so {{var}} tokens survive
// verbatim — encoding only happens at send time, per the request's settings.

function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = noHash.indexOf('?');
  return {
    base: qIdx >= 0 ? noHash.slice(0, qIdx) : noHash,
    query: qIdx >= 0 ? noHash.slice(qIdx + 1) : '',
    hash,
  };
}

// Derive the query-params table from a URL. Enabled rows are taken from the URL's
// query (reusing existing rows by position to keep ids/focus stable); disabled
// rows aren't represented in the URL, so they're preserved as-is at the end.
export function paramsFromUrl(url: string, existing: KeyValue[]): KeyValue[] {
  const { query } = splitUrl(url);
  const pairs = query
    ? query.split('&').filter((s) => s !== '').map((seg) => {
        const eq = seg.indexOf('=');
        return { key: eq === -1 ? seg : seg.slice(0, eq), value: eq === -1 ? '' : seg.slice(eq + 1) };
      })
    : [];
  const enabledPrev = existing.filter((p) => p.enabled);
  const disabledPrev = existing.filter((p) => !p.enabled);
  const next = pairs.map((p, i) => {
    const reuse = enabledPrev[i];
    return reuse ? { ...reuse, key: p.key, value: p.value, enabled: true } : newKeyValue(p.key, p.value);
  });
  return [...next, ...disabledPrev];
}

// Rebuild a URL's query string from the enabled params (raw — {{var}} preserved).
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const query = params
    .filter((p) => p.enabled && p.key.trim() !== '')
    .map((p) => `${p.key}=${p.value}`)
    .join('&');
  return base + (query ? `?${query}` : '') + hash;
}

// ─── formatting helpers ─────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Pretty-print JSON bodies; leave everything else untouched.
export function prettyBody(body: string, contentType: string): string {
  if (/json/i.test(contentType) || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

// Tailwind text color for an HTTP status family.
export function statusColor(status: number): string {
  // 2xx thành công, 3xx "chú ý một chút", 4xx/5xx lỗi — ánh xạ 1-1 sang hệ
  // trạng thái của kit, không phải bảng màu Tailwind.
  if (status === 0) return 'text-bad';
  if (status < 300) return 'text-ok';
  if (status < 400) return 'text-warn';
  return 'text-bad';
}
