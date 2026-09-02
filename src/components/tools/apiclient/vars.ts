// {{variable}} substitution.
//
// Split out of request.ts so the scripting sandbox can use it without pulling
// the whole HTTP layer (and the Tauri plugin import it lazily loads) into the
// worker bundle.

import type { Environment, KeyValue, ResolvedVar, VarMap } from './types';

// Replace every {{name}} token using the supplied variable map. Unknown tokens
// are left as-is so the user can see what didn't resolve.
//
// `hasOwnProperty`, not `name in vars`: `in` walks the prototype chain, so
// every member of Object.prototype counted as a defined variable and
// substituted its function. `{{constructor}}` in a URL became the literal text
// `function Object() { [native code] }` in the request that was sent, instead
// of staying visible as an unresolved token.
export function substituteVars(text: string, vars: VarMap): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

// Merge Collection Variables/Collection env/Global env/Vault into one
// source-tagged list — the four scattered editors' winning values in one
// place, for EnvQuickView's glance popover (see ApiClient.tsx's
// `resolvedVars`). Same precedence as engine.ts's real substitution and
// ApiClient.tsx's `varMap`: collectionVar < globalEnv < collectionEnv; Vault
// is namespaced (`vault.<key>`) so it never collides with the others
// regardless of order. Sorted by name so callers don't each have to.
export function buildResolvedVars(
  collectionVars: VarMap,
  collectionEnv: Environment | null,
  globalEnv: Environment | null,
  vault: KeyValue[],
): ResolvedVar[] {
  const byName = new Map<string, ResolvedVar>();
  for (const [name, value] of Object.entries(collectionVars)) {
    byName.set(name, { name, value, secret: false, source: 'collectionVar' });
  }
  if (globalEnv) {
    for (const v of globalEnv.variables) {
      if (v.enabled && v.key) byName.set(v.key, { name: v.key, value: v.value, secret: !!v.secret, source: 'globalEnv' });
    }
  }
  if (collectionEnv) {
    for (const v of collectionEnv.variables) {
      if (v.enabled && v.key) byName.set(v.key, { name: v.key, value: v.value, secret: !!v.secret, source: 'collectionEnv' });
    }
  }
  // Vault values are never read in here, real or masked — always a fixed
  // placeholder, so there is no path for a real one to leak out of Vault's
  // own manager through this merged view.
  for (const v of vault) {
    if (v.enabled && v.key) byName.set(`vault.${v.key}`, { name: `vault.${v.key}`, value: '••••••••', secret: true, source: 'vault' });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
