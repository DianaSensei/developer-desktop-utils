// Parse a cURL command into a request, like Bruno's "Import cURL". Handles the
// common flags (method, headers, data, form, urlencode, basic auth); unknown
// flags are skipped.

import { type ApiRequest, type HttpMethod, HTTP_METHODS, newAuth, newKeyValue, newRequest } from './types';

// Shell-aware tokenizer: respects single/double quotes and backslash escapes,
// and folds `\<newline>` line continuations.
function tokenize(cmd: string): string[] {
  const s = cmd.replace(/\\\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === '\\' && i + 1 < s.length) cur += s[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; started = true; }
    else if (/\s/.test(ch)) { if (started) { out.push(cur); cur = ''; started = false; } }
    else { cur += ch; started = true; }
  }
  if (started) out.push(cur);
  return out;
}

const NO_ARG = new Set(['-L', '--location', '--compressed', '-s', '--silent', '-S', '-k', '--insecure', '-i', '-I', '--head', '-v', '--verbose', '-g', '-#', '--progress-bar', '-f', '--fail', '-O', '-j']);

export function parseCurl(input: string): ApiRequest {
  let tokens = tokenize(input.trim());
  if (tokens[0] === 'curl') tokens = tokens.slice(1);

  let method = '';
  let url = '';
  let user = '';
  let body = '';
  const headers: [string, string][] = [];
  const formData: [string, string, boolean][] = []; // key, value, isFile
  const urlencoded: [string, string][] = [];
  let mode: 'none' | 'raw' | 'urlencoded' | 'multipart' = 'none';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const arg = () => tokens[++i] ?? '';
    if (t === '-X' || t === '--request') method = arg().toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = arg();
      const idx = h.indexOf(':');
      if (idx > 0) headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()]);
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      body += (body ? '&' : '') + arg();
      if (mode === 'none') mode = 'raw';
    } else if (t === '--data-urlencode') {
      const kv = arg(); const eq = kv.indexOf('=');
      urlencoded.push(eq >= 0 ? [kv.slice(0, eq), kv.slice(eq + 1)] : [kv, '']);
      mode = 'urlencoded';
    } else if (t === '-F' || t === '--form') {
      const kv = arg(); const eq = kv.indexOf('=');
      const k = eq >= 0 ? kv.slice(0, eq) : kv;
      const v = eq >= 0 ? kv.slice(eq + 1) : '';
      formData.push([k, v.replace(/^@/, ''), v.startsWith('@')]);
      mode = 'multipart';
    } else if (t === '-u' || t === '--user') user = arg();
    else if (t === '--url') url = arg();
    else if (t === '-b' || t === '--cookie') headers.push(['Cookie', arg()]);
    else if (t === '-A' || t === '--user-agent') headers.push(['User-Agent', arg()]);
    else if (t === '-e' || t === '--referer') headers.push(['Referer', arg()]);
    else if (NO_ARG.has(t)) { /* ignore */ }
    else if (t.startsWith('-')) { arg(); /* unknown flag: assume it takes an arg */ }
    else if (!url) url = t;
  }

  if (!method) method = (body || mode !== 'none') ? 'POST' : 'GET';
  const httpMethod: HttpMethod = (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'GET';

  const req = newRequest({ name: 'Imported request', method: httpMethod, url });
  req.headers = headers.map(([k, v]) => newKeyValue(k, v));

  if (user) {
    const idx = user.indexOf(':');
    req.auth = { ...newAuth(), type: 'basic', username: idx >= 0 ? user.slice(0, idx) : user, password: idx >= 0 ? user.slice(idx + 1) : '' };
    req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'authorization');
  }

  const ctHeader = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.toLowerCase() ?? '';
  if (mode === 'urlencoded') {
    req.body = { mode: 'urlencoded', raw: '', form: urlencoded.map(([k, v]) => newKeyValue(k, v)) };
  } else if (mode === 'multipart') {
    req.body = {
      mode: 'multipart', raw: '',
      form: formData.map(([k, v, isFile]) => ({ ...newKeyValue(k, isFile ? '' : v), kind: isFile ? 'file' as const : 'text' as const, fileName: isFile ? v : undefined })),
    };
  } else if (mode === 'raw') {
    const isJson = /json/.test(ctHeader) || /^\s*[[{]/.test(body);
    const isUrlEnc = /x-www-form-urlencoded/.test(ctHeader);
    if (isUrlEnc) {
      req.body = { mode: 'urlencoded', raw: '', form: body.split('&').filter(Boolean).map((p) => { const eq = p.indexOf('='); return newKeyValue(decodeURIComponent(eq >= 0 ? p.slice(0, eq) : p), decodeURIComponent(eq >= 0 ? p.slice(eq + 1) : '')); }) };
    } else {
      req.body = { mode: isJson ? 'json' : 'text', raw: body, form: [] };
    }
  }

  return req;
}
