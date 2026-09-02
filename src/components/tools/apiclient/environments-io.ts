// Environment import / export.
//
// Two formats are accepted/produced:
//  - Postman's environment.json ({id, name, values: [...]}) — for interop with
//    Postman, the same way postman.ts handles the Collection tree.
//  - A native format that round-trips this app's own Environment shape
//    losslessly (aside from id/collectionId, see importEnvironment below).
//
// Vault secrets are never involved here — only plain KeyValue variables travel.

import { newEnvironment, type Environment, type KeyValue } from './types';

interface PmEnvironmentValue { key?: string; value?: string; enabled?: boolean; type?: string }
interface PmEnvironmentFile {
  id?: string;
  name?: string;
  values?: PmEnvironmentValue[];
  _postman_variable_scope?: string;
}

interface NativeEnvironmentFile {
  __devtoolEnvironment: true;
  name: string;
  variables: KeyValue[];
}

function isNativeFormat(json: unknown): json is NativeEnvironmentFile {
  return !!json && typeof json === 'object' && (json as Record<string, unknown>).__devtoolEnvironment === true;
}

// Fresh ids for every row and a defaulted `enabled`, regardless of which
// format (or a hand-edited file) supplied them.
//
// `secret` is read from either format's own way of marking one: this app's
// native export writes it as `secret: true` (see exportEnvironmentNative,
// which serializes the row as-is); Postman's environment.json marks the same
// thing as `"type": "secret"` on the value (its UI's own masking). Missing
// this dropped the lock on every secret-flagged variable on the way back in
// — silently, since nothing here threw or warned — which meant a value the
// user had explicitly protected (masked in the UI, excluded from generated
// code and from History's redaction list; see KeyValueEditor's lock toggle)
// came back in fully exposed after nothing more than an export/import
// round-trip, or an ordinary Postman environment import.
function sanitizeVariables(rows: unknown): KeyValue[] {
  if (!Array.isArray(rows)) return [];
  const out: KeyValue[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key : '';
    if (!key) continue;
    const value = typeof rec.value === 'string' ? rec.value : '';
    const secret = rec.secret === true || rec.type === 'secret';
    out.push({
      id: `iv-${Date.now()}-${Math.random().toString(36).slice(2)}`, key, value,
      enabled: rec.enabled !== false, ...(secret ? { secret: true } : {}),
    });
  }
  return out;
}

export function exportEnvironmentNative(env: Environment): string {
  const file: NativeEnvironmentFile = { __devtoolEnvironment: true, name: env.name, variables: env.variables };
  return JSON.stringify(file, null, 2);
}

export function exportEnvironmentPostman(env: Environment): string {
  const file: PmEnvironmentFile = {
    id: env.id,
    name: env.name,
    // `type` is Postman's own secret marker (its UI masks a "secret" value
    // the same way this app's lock icon does) — carrying it over means a
    // variable protected here stays protected in the exported file too,
    // whether it's opened in Postman or re-imported back into this app.
    values: env.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled, type: v.secret ? 'secret' : 'default' })),
    _postman_variable_scope: 'environment',
  };
  return JSON.stringify(file, null, 2);
}

// Imports either format. The result is always created as a Global environment
// (collectionId: null) — an id/collectionId from the source file can't be
// trusted to match a collection in this workspace (they're generated locally
// and won't line up across machines, or even across two exports of the same
// collection), so re-scoping to a specific collection, if wanted, is a manual
// step after import via the Environments dialog.
export function importEnvironment(text: string): Environment {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (isNativeFormat(json)) {
    return newEnvironment(json.name || 'Imported Environment', null, sanitizeVariables(json.variables));
  }
  const pm = json as PmEnvironmentFile;
  if (!pm || !Array.isArray(pm.values)) {
    throw new Error('Not a recognized environment file (expected a Postman environment.json or an environment exported from this app)');
  }
  return newEnvironment(pm.name || 'Imported Environment', null, sanitizeVariables(pm.values));
}
