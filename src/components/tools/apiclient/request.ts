// Request execution engine.
//
// In the Tauri desktop app we route through the HTTP plugin so the request is
// made from Rust — no browser `Origin` header, no CORS preflight — letting the
// tool hit any API like Postman/Bruno would. On the web build we fall back to
// the standard `fetch` (subject to the target's CORS policy). Requests only ever
// fire when the user clicks Send.

import type { ApiRequest, ApiResponse, KeyValue, VarMap } from './types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function netFetch(input: string, init: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

// ─── variable substitution ──────────────────────────────────────────────────

// Replace every {{name}} token using the supplied variable map. Unknown tokens
// are left as-is so the user can see what didn't resolve.
export function substituteVars(text: string, vars: VarMap): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? vars[name] : whole,
  );
}

const enabledPairs = (list: KeyValue[]): [string, string][] =>
  list.filter((kv) => kv.enabled && kv.key.trim()).map((kv) => [kv.key, kv.value]);

type Sub = (s: string) => string;

// Build the final URL: substitute vars, then append enabled query params.
// When the request's URL-encoding setting is off, params are appended raw so the
// user keeps full control of the query string (Bruno's "URL Encoding" toggle).
function buildUrl(req: ApiRequest, sub: Sub): string {
  const base = sub(req.url).trim();
  const params = enabledPairs(req.params).map(
    ([k, v]) => [sub(k), sub(v)] as [string, string],
  );
  if (!params.length) return base;

  const [head, existingQuery = ''] = base.split('#')[0].split('?');

  if (req.settings?.encodeUrl === false) {
    const raw = params.map(([k, v]) => `${k}=${v}`).join('&');
    const query = [existingQuery, raw].filter(Boolean).join('&');
    return query ? `${head}?${query}` : head;
  }

  const search = new URLSearchParams(existingQuery);
  for (const [k, v] of params) search.append(k, v);
  const query = search.toString();
  return query ? `${head}?${query}` : head;
}

// Assemble headers from the headers list, auth, and the body content-type.
function buildHeaders(req: ApiRequest, sub: Sub): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of enabledPairs(req.headers)) {
    headers[sub(k)] = sub(v);
  }

  if (req.auth.type === 'bearer' && req.auth.token.trim()) {
    headers['Authorization'] = `Bearer ${sub(req.auth.token).trim()}`;
  } else if (req.auth.type === 'basic') {
    const user = sub(req.auth.username);
    const pass = sub(req.auth.password);
    headers['Authorization'] = `Basic ${btoa(`${user}:${pass}`)}`;
  }

  const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
  if (!hasContentType && req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = BODY_CONTENT_TYPE[req.body.mode];
    // multipart is intentionally omitted so fetch can set the boundary itself.
    if (ct) headers['Content-Type'] = ct === 'file' ? (req.body.fileType || 'application/octet-stream') : ct;
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

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export async function sendRequest(
  req: ApiRequest,
  vars: VarMap,
  signal?: AbortSignal,
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
  if (timeoutCtl) {
    timer = setTimeout(() => timeoutCtl.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
    signal?.addEventListener('abort', () => timeoutCtl.abort(), { once: true });
  }

  const init: RequestInit & { maxRedirections?: number } = {
    method: req.method,
    headers: buildHeaders(req, sub),
    signal: timeoutCtl ? timeoutCtl.signal : signal,
    redirect: req.settings?.followRedirects === false ? 'manual' : 'follow',
  };
  // Tauri's HTTP plugin honours `maxRedirections`; harmless on web fetch.
  if (req.settings?.followRedirects !== false) init.maxRedirections = req.settings?.maxRedirects ?? 5;
  const body = buildBody(req, sub);
  if (body !== undefined) init.body = body;

  const start = performance.now();
  let res: Response;
  try {
    res = await netFetch(finalUrl, init);
  } catch (e) {
    if ((e as Error).name === 'TimeoutError' || (timeoutCtl?.signal.aborted && !signal?.aborted)) {
      throw new Error(`Request timed out after ${timeout} ms`);
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  const timeMs = Math.round(performance.now() - start);

  const headers: [string, string][] = [];
  res.headers.forEach((value, key) => headers.push([key, value]));

  const contentType = res.headers.get('content-type') ?? '';
  const lengthHeader = res.headers.get('content-length');
  const sizeBytes = lengthHeader ? Number(lengthHeader) : byteLength(text);

  return {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    headers,
    body: text,
    contentType,
    timeMs,
    sizeBytes,
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
  sparql: 'application/sparql-query', urlencoded: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data', none: null, file: null,
};

function resolveBody(req: ApiRequest, sub: Sub): ResolvedBody {
  const b = req.body;
  switch (b.mode) {
    case 'json': case 'xml': case 'text': case 'sparql':
      return b.raw ? { type: 'raw', text: sub(b.raw), contentType: DISPLAY_CONTENT_TYPE[b.mode] ?? 'text/plain' } : { type: 'none' };
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
export function resolveRequest(req: ApiRequest, vars: VarMap, interpolate: boolean): ResolvedRequest {
  const sub: Sub = interpolate ? (s) => substituteVars(s, vars) : (s) => s;
  const url = buildUrl(req, sub) || sub(req.url);
  const finalUrl = url && !/^https?:\/\//i.test(url) ? `http://${url}` : url;

  const headers: [string, string][] = Object.entries(buildHeaders(req, sub));
  if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    const ct = DISPLAY_CONTENT_TYPE[req.body.mode] ?? (req.body.mode === 'file' ? req.body.fileType : null);
    if (ct) headers.push(['Content-Type', ct]);
  }
  return { method: req.method, url: finalUrl, headers, body: resolveBody(req, sub) };
}

export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// ─── formatting helpers ─────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
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
  if (status === 0) return 'text-destructive';
  if (status < 300) return 'text-emerald-600 dark:text-emerald-400';
  if (status < 400) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}
