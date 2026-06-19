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

// Build the final URL: substitute vars, then append enabled query params.
function buildUrl(req: ApiRequest, vars: VarMap): string {
  const base = substituteVars(req.url, vars).trim();
  const params = enabledPairs(req.params);
  if (!params.length) return base;

  const [head, existingQuery = ''] = base.split('#')[0].split('?');
  const search = new URLSearchParams(existingQuery);
  for (const [k, v] of params) search.append(substituteVars(k, vars), substituteVars(v, vars));
  const query = search.toString();
  return query ? `${head}?${query}` : head;
}

// Assemble headers from the headers list, auth, and the body content-type.
function buildHeaders(req: ApiRequest, vars: VarMap): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of enabledPairs(req.headers)) {
    headers[substituteVars(k, vars)] = substituteVars(v, vars);
  }

  if (req.auth.type === 'bearer' && req.auth.token.trim()) {
    headers['Authorization'] = `Bearer ${substituteVars(req.auth.token, vars).trim()}`;
  } else if (req.auth.type === 'basic') {
    const user = substituteVars(req.auth.username, vars);
    const pass = substituteVars(req.auth.password, vars);
    headers['Authorization'] = `Basic ${btoa(`${user}:${pass}`)}`;
  }

  const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
  if (!hasContentType) {
    if (req.body.mode === 'json') headers['Content-Type'] = 'application/json';
    else if (req.body.mode === 'urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  return headers;
}

// Build the request body. Returns undefined for methods/modes without a body.
function buildBody(req: ApiRequest, vars: VarMap): BodyInit | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  switch (req.body.mode) {
    case 'json':
    case 'raw':
      return req.body.raw ? substituteVars(req.body.raw, vars) : undefined;
    case 'urlencoded': {
      const p = new URLSearchParams();
      for (const [k, v] of enabledPairs(req.body.form)) p.append(substituteVars(k, vars), substituteVars(v, vars));
      return p.toString();
    }
    case 'form-data': {
      const fd = new FormData();
      for (const [k, v] of enabledPairs(req.body.form)) fd.append(substituteVars(k, vars), substituteVars(v, vars));
      return fd;
    }
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
  const url = buildUrl(req, vars);
  if (!url) throw new Error('Enter a request URL');
  // Default to http:// if the user omitted the scheme.
  const finalUrl = /^https?:\/\//i.test(url) ? url : `http://${url}`;

  const init: RequestInit = {
    method: req.method,
    headers: buildHeaders(req, vars),
    signal,
  };
  const body = buildBody(req, vars);
  if (body !== undefined) init.body = body;

  const start = performance.now();
  const res = await netFetch(finalUrl, init);
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

// Build a copy-pasteable cURL command for the request (vars substituted).
export function toCurl(req: ApiRequest, vars: VarMap): string {
  const url = buildUrl(req, vars) || substituteVars(req.url, vars);
  const finalUrl = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  const parts = [`curl -X ${req.method} ${shellQuote(finalUrl)}`];
  for (const [k, v] of Object.entries(buildHeaders(req, vars))) {
    parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  }
  const body = buildBody(req, vars);
  if (typeof body === 'string' && body) parts.push(`-d ${shellQuote(body)}`);
  return parts.join(' \\\n  ');
}

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

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
