// Parse a cURL command into a request, like Bruno's "Import cURL". Handles the
// common flags (method, headers, data, form, urlencode, basic auth); unknown
// flags are skipped.

import { type ApiRequest, type HttpMethod, HTTP_METHODS, newAuth, newKeyValue, newRequest } from './types';

// The escapes bash resolves inside ANSI-C quoting ($'…'). Anything else after
// a backslash stands for itself, which is what bash does too.
const ANSI_C_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '0': '\0',
};

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
    } else if (ch === '$' && s[i + 1] === "'") {
      // ANSI-C quoting, $'…'. Chrome and Edge DevTools switch "Copy as cURL
      // (bash)" into this form the moment the body contains a newline — so a
      // pretty-printed JSON payload arrives this way rather than in ordinary
      // single quotes. Read as a plain quoted string it kept the leading `$`
      // and left every `\n` as the two characters backslash-n, producing a
      // body that was neither valid JSON nor what was copied.
      i += 2;
      for (; i < s.length && s[i] !== "'"; i++) {
        if (s[i] === '\\' && i + 1 < s.length) {
          const c = s[++i];
          cur += ANSI_C_ESCAPES[c] ?? c;
        } else cur += s[i];
      }
      started = true;
    } else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; started = true; }
    else if (/\s/.test(ch)) { if (started) { out.push(cur); cur = ''; started = false; } }
    else { cur += ch; started = true; }
  }
  if (started) out.push(cur);
  return out;
}

// Flags that take no value. Anything missing from here falls through to the
// "assume it takes an argument" branch at the end of the parse loop, which for
// a boolean flag eats the token after it — and that token is very often the
// URL. `-G` was the case that showed it up: `curl -G https://api.test/x -d
// 'a=1'` imported with an empty URL.
const NO_ARG = new Set([
  '-L', '--location', '--location-trusted', '--compressed', '-s', '--silent', '-S', '--show-error',
  '-k', '--insecure', '-i', '--include', '-I', '--head', '-v', '--verbose', '-g', '--globoff',
  '-#', '--progress-bar', '--no-progress-meter', '-f', '--fail', '--fail-with-body', '-O', '-j',
  '-G', '--get', '-N', '--no-buffer', '--raw', '--path-as-is', '-4', '--ipv4', '-6', '--ipv6',
  '--http0.9', '--http1.0', '--http1.1', '--http2', '--http2-prior-knowledge', '--http3',
  '--tlsv1', '--tlsv1.0', '--tlsv1.1', '--tlsv1.2', '--tlsv1.3', '--ssl', '--ssl-reqd',
  '--anyauth', '--basic', '--digest', '--ntlm', '--negotiate', '--tcp-nodelay', '--no-keepalive',
  '-a', '--append', '-q', '--disable', '-Z', '--parallel', '--tr-encoding', '--no-sessionid',
]);

// A token that is unmistakably the request URL, so an unknown flag never
// consumes it as its own value. Deliberately narrow — an absolute URL with a
// scheme, which is what every "Copy as cURL" produces — so that a genuine
// option value like `--cert /path/to.pem` is still consumed normally.
const looksLikeUrl = (t: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(t);

// Chrome/Edge DevTools offer two "Copy as cURL" variants on Windows: "(bash)"
// and "(cmd)". `tokenize()` above only understands POSIX/bash quoting
// (backslash escapes, `\<newline>` continuation) — cmd.exe's own escaping
// (`^<newline>` continuation, doubled `""` inside double-quoted values) reads
// as garbage to it. A cmd-style paste is reliably identifiable by a `^` right
// before a line break, which bash has no reason to ever produce there.
export function looksLikeCmdFormat(input: string): boolean {
  return /\^[ \t]*\r?\n/.test(input);
}

// Whether the parsed request carries a credential that's a snapshot of the
// browser session it was copied from (a Cookie/Authorization header, or
// -u/--user basic-auth parsed into req.auth) — these expire or get rotated by
// the server independently of the request itself, so a request that worked
// at import time can start failing later for a reason that has nothing to do
// with the request's own configuration.
export function hasSessionCredentials(req: ApiRequest): boolean {
  if (req.auth.type === 'basic') return true;
  return req.headers.some((h) => ['cookie', 'authorization'].includes(h.key.toLowerCase()));
}

// Whether a raw -d/--data body has the `key=value(&key=value)*` shape a form
// submit produces — used to apply curl's own default Content-Type (see
// parseCurl below) when the command declares no header at all.
function looksUrlEncoded(body: string): boolean {
  return body.trim() !== '' && body.split('&').every((seg) => /^[^&=\s]+=/.test(seg));
}

/** Form-decodes one key or value the way a server reads it (`+` is a
 *  space), keeping text that is not valid percent-encoding (`50%`) as it is
 *  instead of throwing. */
function formDecode(s: string): string {
  const spaced = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced.replace(/%([0-9A-Fa-f]{2})/g, (m, hex: string) => {
      try { return decodeURIComponent(`%${hex}`); } catch { return m; }
    });
  }
}

function splitFormPairs(body: string): [string, string][] {
  return body.split('&').filter(Boolean).map((p) => {
    const eq = p.indexOf('=');
    return [formDecode(eq >= 0 ? p.slice(0, eq) : p), formDecode(eq >= 0 ? p.slice(eq + 1) : '')];
  });
}

// Short options that take a value may have it attached (`-XPUT`,
// `-H'Accept: x'`, `-uuser:pass`); split them so the loop sees two tokens.
const ATTACHABLE = new Set(['X', 'H', 'd', 'F', 'u', 'b', 'A', 'e']);
function splitAttached(tokens: string[]): string[] {
  return tokens.flatMap((t) =>
    /^-[A-Za-z]./.test(t) && !t.startsWith('--') && ATTACHABLE.has(t[1]) ? [t.slice(0, 2), t.slice(2)] : [t],
  );
}

export function parseCurl(input: string): ApiRequest {
  let tokens = tokenize(input.trim());
  if (tokens[0] === 'curl') tokens = tokens.slice(1);
  tokens = splitAttached(tokens);

  let method = '';
  let url = '';
  let user = '';
  let body = '';
  const headers: [string, string][] = [];
  const formData: [string, string, boolean][] = []; // key, value, isFile
  const urlencoded: [string, string][] = [];
  // -d data in order, so it can join --data-urlencode pairs instead of
  // being dropped when both are used (OAuth token requests do).
  const dataParts: string[] = [];
  let mode: 'none' | 'raw' | 'urlencoded' | 'multipart' = 'none';
  // -G/--get: curl appends the data to the query string and sends a GET
  // instead of putting it in a body.
  let asQuery = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const arg = () => tokens[++i] ?? '';
    if (t === '-X' || t === '--request') method = arg().toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = arg();
      const idx = h.indexOf(':');
      if (idx > 0) headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()]);
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      const data = arg();
      dataParts.push(data);
      if (mode === 'urlencoded') urlencoded.push(...splitFormPairs(data));
      else {
        body += (body ? '&' : '') + data;
        if (mode === 'none') mode = 'raw';
      }
    } else if (t === '--json') {
      // curl 7.82+: the data, plus JSON Content-Type and Accept, POST by default.
      body += arg();
      mode = 'raw';
      if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json']);
      if (!headers.some(([k]) => k.toLowerCase() === 'accept')) headers.push(['Accept', 'application/json']);
    } else if (t === '-I' || t === '--head') {
      if (!method) method = 'HEAD';
    } else if (t === '--data-urlencode') {
      const kv = arg(); const eq = kv.indexOf('=');
      if (mode !== 'urlencoded') {
        // Earlier -d data becomes form fields alongside this one.
        urlencoded.push(...dataParts.flatMap(splitFormPairs));
        body = '';
      }
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
    else if (t === '-G' || t === '--get') asQuery = true;
    else if (NO_ARG.has(t)) { /* ignore */ }
    else if (t.startsWith('-')) {
      // Unknown flag. Most curl flags that take a value are followed by a
      // plain token (`--max-time 30`), so consuming one is the right default
      // — but never the URL, which a boolean flag we don't know about would
      // otherwise swallow, and never another flag.
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-') && !looksLikeUrl(next)) i++;
    }
    else if (!url) url = t;
  }

  // With -G the collected data belongs in the query string, not a body.
  if (asQuery) {
    const pairs = mode === 'urlencoded'
      ? urlencoded.map(([k, v]) => `${k}=${v}`)
      : body.split('&').filter(Boolean);
    if (pairs.length) url += (url.includes('?') ? '&' : '?') + pairs.join('&');
    body = '';
    mode = 'none';
    if (!method) method = 'GET';
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
    // curl itself defaults -d/--data*/--data-binary/--data-ascii to
    // application/x-www-form-urlencoded whenever the command sets no explicit
    // Content-Type — so a bare `-d 'a=1&b=2'` with no -H at all is exactly as
    // form-encoded as one that spells the header out, and importing it as
    // plain text would silently disagree with what curl actually sends.
    const isUrlEnc = /x-www-form-urlencoded/.test(ctHeader) || (!ctHeader && !isJson && looksUrlEncoded(body));
    if (isUrlEnc) {
      req.body = { mode: 'urlencoded', raw: '', form: splitFormPairs(body).map(([k, v]) => newKeyValue(k, v)) };
    } else {
      req.body = { mode: isJson ? 'json' : 'text', raw: body, form: [] };
    }
  }

  return req;
}
