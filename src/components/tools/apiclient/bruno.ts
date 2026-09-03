// Bruno (.bru) single-request file import.
//
// Bruno's own request format is a flat sequence of top-level `name { ... }` /
// `name:subtype { ... }` blocks — `meta`, an HTTP-method block (`get`, `post`,
// …) that references which `body:*` / `auth:*` block holds the real content,
// `headers`, `query`, `params:path`, `script:pre-request`, `script:post-response`,
// `tests`, `assert`. Dictionary-style blocks (meta, headers, query, params:path,
// auth:*, assert, form bodies) hold one `key: value` pair per line; a leading
// `~` disables that row. Everything else is a raw text block.
// Reference: https://docs.usebruno.com/bru-lang/overview
//
// This app's data model (types.ts) already mirrors Bruno's own concepts
// (collection/folder headers, per-request scripts, declarative Assert), so
// import is mostly a field mapping — the same shape postman.ts and openapi.ts
// already have.

import {
  type ApiRequest, type Assertion, type Auth, type BodyMode, type Collection,
  type HttpMethod, type KeyValue, type RequestBody,
  HTTP_METHODS, migrateAssertOp, newAuth, newCollection, newRequest, uid,
} from './types';

interface BruBlock { name: string; body: string }

// Split the file into top-level blocks by brace depth, so a JSON body (or
// script) containing `}` at the start of a line is never mistaken for the
// block's own close.
function splitBlocks(text: string): BruBlock[] {
  const blocks: BruBlock[] = [];
  const re = /([a-zA-Z0-9:_-]+)\s*\{/g;
  let idx = 0;
  while (idx < text.length) {
    re.lastIndex = idx;
    const m = re.exec(text);
    if (!m) break;
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    blocks.push({ name: m[1], body: text.slice(start, depth === 0 ? i - 1 : i) });
    idx = i;
  }
  return blocks;
}

function parseDict(body: string): KeyValue[] {
  const out: KeyValue[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const enabled = !line.startsWith('~');
    const clean = enabled ? line : line.slice(1);
    const sep = clean.indexOf(':');
    if (sep === -1) continue;
    out.push({ id: uid(), key: clean.slice(0, sep).trim(), value: clean.slice(sep + 1).trim(), enabled });
  }
  return out;
}

const dictGet = (list: KeyValue[], key: string): string => list.find((kv) => kv.key === key)?.value ?? '';

const RAW_BODY_MODES = new Set(['json', 'xml', 'text', 'sparql']);

function importBody(bodyRef: string, find: (name: string) => BruBlock | undefined, warn: (msg: string) => void): RequestBody {
  const empty: RequestBody = { mode: 'none', raw: '', form: [] };
  if (bodyRef === 'none' || !bodyRef) return empty;
  if (RAW_BODY_MODES.has(bodyRef)) {
    return { mode: bodyRef as BodyMode, raw: find(`body:${bodyRef}`)?.body.trim() ?? '', form: [] };
  }
  if (bodyRef === 'graphql') {
    return {
      mode: 'graphql', raw: '', form: [],
      graphql: {
        query: find('body:graphql')?.body.trim() ?? '',
        variables: find('body:graphql:vars')?.body.trim() ?? '',
      },
    };
  }
  if (bodyRef === 'formUrlEncoded' || bodyRef === 'form-urlencoded') {
    const b = find('body:form-urlencoded');
    return { mode: 'urlencoded', raw: '', form: b ? parseDict(b.body) : [] };
  }
  if (bodyRef === 'multipartForm' || bodyRef === 'multipart-form') {
    const b = find('body:multipart-form');
    const form = (b ? parseDict(b.body) : []).map((kv) => {
      const fileMatch = /^@file\(([^)]*)\)$/.exec(kv.value.trim());
      if (!fileMatch) return { ...kv, kind: 'text' as const };
      warn(`Multipart field "${kv.key}" references a local file (${fileMatch[1]}) — re-attach it manually.`);
      return { ...kv, kind: 'file' as const, fileName: fileMatch[1], value: '' };
    });
    return { mode: 'multipart', raw: '', form };
  }
  if (bodyRef === 'file') {
    warn('A binary file body is not imported — re-attach the file manually.');
    return { mode: 'file', raw: '', form: [] };
  }
  warn(`Unsupported Bruno body type "${bodyRef}" — imported with no body.`);
  return empty;
}

// Auth types this app can actually reproduce — same contract as postman.ts's
// SUPPORTED_AUTH_TYPES.
const SUPPORTED_AUTH = new Set(['none', 'inherit', 'bearer', 'basic', 'digest', 'apikey', 'oauth2']);

function importAuth(authRef: string, find: (name: string) => BruBlock | undefined, warn: (msg: string) => void): Auth {
  const base = newAuth();
  if (!authRef || authRef === 'none') return base;
  if (!SUPPORTED_AUTH.has(authRef)) {
    warn(`Unsupported Bruno auth type "${authRef}" — imported as No Auth.`);
    return base;
  }
  if (authRef === 'inherit') return { ...base, type: 'inherit' };

  const dict = parseDict(find(`auth:${authRef}`)?.body ?? '');
  const get = (key: string) => dictGet(dict, key);
  if (authRef === 'bearer') return { ...base, type: 'bearer', token: get('token') };
  if (authRef === 'basic') return { ...base, type: 'basic', username: get('username'), password: get('password') };
  if (authRef === 'digest') return { ...base, type: 'digest', username: get('username'), password: get('password') };
  if (authRef === 'apikey') {
    const placement = /query/i.test(get('placement') || get('in')) ? 'query' : 'header';
    return { ...base, type: 'apikey', apiKey: { key: get('key'), value: get('value'), placement } };
  }
  // oauth2
  const grantType = /password/i.test(get('grant_type') || get('grantType')) ? 'password' : 'client_credentials';
  return {
    ...base,
    type: 'oauth2',
    oauth2: {
      grantType,
      tokenUrl: get('token_url') || get('tokenUrl') || get('access_token_url'),
      clientId: get('client_id') || get('clientId'),
      clientSecret: get('client_secret') || get('clientSecret'),
      scope: get('scope'),
      username: get('username'),
      password: get('password'),
    },
  };
}

function parseAssertions(body: string): Assertion[] {
  return parseDict(body).map((kv) => {
    const [opToken, ...rest] = kv.value.trim().split(/\s+/);
    return {
      id: uid(),
      expr: kv.key,
      operator: migrateAssertOp(opToken || 'equals'),
      value: rest.join(' '),
      enabled: kv.enabled,
    };
  });
}

export interface BrunoImport {
  collection: Collection;
  // Notes about anything that couldn't be mapped one-to-one, shown after
  // import the same way postman.ts's and openapi.ts's warnings are.
  warnings: string[];
}

export const isBrunoFile = (name: string): boolean => /\.bru$/i.test(name);

const METHOD_BLOCK_NAMES = new Set(HTTP_METHODS.map((m) => m.toLowerCase()));

// Wraps the single parsed request in a fresh one-item Collection so it can go
// through the same `store.importCollection()` / script-review flow as a
// Postman or OpenAPI import — Sidebar.tsx doesn't need a separate code path
// for "add one request" vs. "import a collection".
export function importBru(text: string, fileName: string): BrunoImport {
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);

  const blocks = splitBlocks(text);
  const find = (name: string) => blocks.find((b) => b.name === name);

  const methodBlock = blocks.find((b) => METHOD_BLOCK_NAMES.has(b.name));
  if (!methodBlock) {
    throw new Error(`${fileName} doesn't look like a Bruno request file (no http method block found)`);
  }
  const methodDict = parseDict(methodBlock.body);
  const method = methodBlock.name.toUpperCase() as HttpMethod;
  const url = dictGet(methodDict, 'url');
  const bodyRef = dictGet(methodDict, 'body');
  const authRef = dictGet(methodDict, 'auth');

  const metaDict = parseDict(find('meta')?.body ?? '');
  const name = dictGet(metaDict, 'name') || fileName.replace(/\.bru$/i, '');

  const headers = parseDict(find('headers')?.body ?? '');
  const params = parseDict(find('query')?.body ?? '');
  const pathParams = parseDict(find('params:path')?.body ?? '');

  const body = importBody(bodyRef, find, warn);
  const auth = importAuth(authRef, find, warn);

  const scriptReq = find('script:pre-request')?.body.trim() ?? '';
  const scriptRes = find('script:post-response')?.body.trim() ?? '';
  const tests = find('tests')?.body.trim() ?? '';
  const assertions = parseAssertions(find('assert')?.body ?? '');

  if (find('vars:pre-request') || find('vars:post-response')) {
    warn('Bruno "vars" blocks aren\'t supported — pre/post-request variables were skipped.');
  }

  const req: ApiRequest = newRequest({
    name, method, url, params, pathParams, headers, body, auth,
    script: { req: scriptReq, res: scriptRes }, assertions, tests,
  });

  const collection = newCollection(name);
  collection.items = [req];
  return { collection, warnings };
}
