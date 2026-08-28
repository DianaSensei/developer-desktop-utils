// Which {{variables}} a request actually references.
//
// Used by the Runner to show how a data file's columns map onto the run: a
// column nothing references is almost always a typo or a stale file, and a
// variable the requests need but the file doesn't provide will silently send
// the literal `{{token}}` to the server. Both are worth pointing out before the
// run rather than after.
//
// The fields scanned here are exactly the ones request.ts substitutes into, so
// "used" means used — not merely "the word appears somewhere in the request".
// Scripts are deliberately excluded: they read data through bru.getEnvVar()/
// getCollectionVar(), not
// {{token}} substitution, so scanning their text would report false positives.

import type { ApiRequest } from './types';

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

function addFrom(text: string | undefined, into: Set<string>): void {
  if (!text) return;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) into.add(m[1]);
}

export function requestVarTokens(req: ApiRequest, into = new Set<string>()): Set<string> {
  addFrom(req.url, into);

  for (const p of req.params ?? []) {
    if (!p.enabled) continue;
    addFrom(p.key, into);
    addFrom(p.value, into);
  }
  for (const p of req.pathParams ?? []) {
    if (!p.enabled) continue;
    addFrom(p.value, into);
  }
  for (const h of req.headers ?? []) {
    if (!h.enabled) continue;
    addFrom(h.key, into);
    addFrom(h.value, into);
  }

  const body = req.body;
  if (body) {
    if (body.mode === 'graphql') {
      addFrom(body.graphql?.query, into);
      addFrom(body.graphql?.variables, into);
    } else if (body.mode === 'urlencoded' || body.mode === 'multipart') {
      for (const f of body.form ?? []) {
        if (!f.enabled) continue;
        addFrom(f.key, into);
        addFrom(f.value, into);
      }
    } else if (body.mode !== 'none' && body.mode !== 'file') {
      addFrom(body.raw, into);
    }
  }

  const auth = req.auth;
  if (auth) {
    switch (auth.type) {
      case 'bearer':
        addFrom(auth.token, into);
        break;
      case 'basic':
      case 'digest':
        addFrom(auth.username, into);
        addFrom(auth.password, into);
        break;
      case 'apikey':
        addFrom(auth.apiKey?.key, into);
        addFrom(auth.apiKey?.value, into);
        break;
      case 'oauth2': {
        const o = auth.oauth2;
        addFrom(o?.tokenUrl, into);
        addFrom(o?.clientId, into);
        addFrom(o?.clientSecret, into);
        addFrom(o?.scope, into);
        addFrom(o?.username, into);
        addFrom(o?.password, into);
        break;
      }
    }
  }

  return into;
}

// Union across every request that will run.
export function collectVarTokens(requests: ApiRequest[]): Set<string> {
  const all = new Set<string>();
  for (const r of requests) requestVarTokens(r, all);
  return all;
}

export interface ColumnMapping {
  column: string;
  /** The token the column binds to, e.g. `{{userId}}`. */
  token: string;
  /** First non-empty value in the file, for a preview of what will be sent. */
  sample: string;
  /** True when at least one request in the run references the token. */
  used: boolean;
}

export function mapColumns(
  columns: string[],
  rows: Record<string, string>[],
  used: Set<string>,
): ColumnMapping[] {
  return columns.map((column) => ({
    column,
    token: `{{${column}}}`,
    sample: rows.find((r) => (r[column] ?? '') !== '')?.[column] ?? '',
    used: used.has(column),
  }));
}

// Variables the run needs that the data file doesn't supply. Environment and
// collection variables cover most of them, so this is only a warning surface
// — `known` carries the names resolvable from elsewhere.
export function missingColumns(used: Set<string>, columns: string[], known: Set<string>): string[] {
  const provided = new Set(columns);
  return [...used].filter((v) => !provided.has(v) && !known.has(v)).sort();
}
