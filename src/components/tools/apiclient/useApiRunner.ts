// Shared request-running logic for the API Client — split out of
// ApiClient.tsx so it can be instantiated once at the app root (see
// `mcpRuntimeContext.tsx`) and reused both by the mounted tool UI and, when the user
// opts into the background MCP bridge (Settings → MCP), by a call that comes
// in while the tool isn't on screen. Both consumers must share the exact
// same `store` and the same `runRequest`/`persistResult` pair — instantiating
// this hook twice against two different `store` instances would let a UI
// edit and a concurrent MCP edit silently clobber each other's localStorage
// write (see mcpRuntimeContext.tsx for the full explanation).

import { useCallback, useRef } from 'react';
import type { ApiStore } from './store';
import { executeRequest } from './engine';
import type { ApiRequest, Environment, KeyValue, VarMap } from './types';

export function useApiRunner(store: ApiStore, scriptTimeoutMs: number) {
  // Read through a ref so `runRequest`/`send` don't churn when unrelated
  // config values change.
  const scriptTimeoutRef = useRef(scriptTimeoutMs);
  scriptTimeoutRef.current = scriptTimeoutMs;

  // Fold a script's changed values back into a variable-row array, adding new
  // rows for names that didn't exist before — shared by all three persisted
  // stores a script can write into (Collection Variables, Collection env,
  // Global env).
  const mergeVarsIntoRows = (rows: KeyValue[], vars: VarMap): KeyValue[] => {
    const merged = rows.map((v) => (v.key in vars ? { ...v, value: vars[v.key] } : v));
    const existing = new Set(rows.map((v) => v.key));
    for (const [k, val] of Object.entries(vars)) {
      if (!existing.has(k)) merged.push({ id: `s-${Date.now()}-${k}`, key: k, value: val, enabled: true });
    }
    return merged;
  };

  // After a run, persist collection-var/env-var changes and (unless
  // suppressed) record a history entry. `collectionEnv`/`globalEnv`
  // must be the same environments (or null) that were actually passed to
  // executeRequest for this run — never re-derived from
  // `store.activeCollectionEnv`/`store.activeGlobalEnv`, which reflect
  // whatever tab/collection is merely "active" and can differ from the
  // collection the run's own request belongs to (see `getEnvsForRequest` in
  // store.ts).
  const persistResult = useCallback((
    req: ApiRequest,
    collectionEnv: Environment | null,
    globalEnv: Environment | null,
    result: Awaited<ReturnType<typeof executeRequest>>,
    recordHistory = true,
  ) => {
    // Capture any Set-Cookie into the jar (scoped to the URL that returned them).
    if (store.cookiesEnabled && result.response?.setCookies?.length) {
      store.captureCookies(result.response.url ?? req.url, result.response.setCookies);
    }
    if (result.collectionEnvChanged && collectionEnv) {
      store.updateEnvironment(collectionEnv.id, { variables: mergeVarsIntoRows(collectionEnv.variables, result.collectionEnvVars) });
    }
    if (result.globalEnvChanged && globalEnv) {
      store.updateEnvironment(globalEnv.id, { variables: mergeVarsIntoRows(globalEnv.variables, result.globalEnvVars) });
    }
    if (result.collectionVarsChanged) {
      const owningCollectionId = store.getOwningCollectionId(req.id);
      const collection = owningCollectionId ? store.collections.find((c) => c.id === owningCollectionId) : null;
      if (owningCollectionId && collection) {
        store.setCollectionVariables(owningCollectionId, mergeVarsIntoRows(collection.variables ?? [], result.collectionVars));
      }
    }
    if (!recordHistory) return;
    // Values that must never be persisted in plaintext if the server happened
    // to echo them back in the response (see redactText in store.ts). Secret-
    // flagged environment variables get the same treatment as vault values.
    const secretEnvValues = [...(collectionEnv?.variables ?? []), ...(globalEnv?.variables ?? [])]
      .filter((v) => v.secret && v.value).map((v) => v.value);
    const sensitiveValues = [...Object.values(store.vaultVars), ...secretEnvValues];
    store.addHistory({
      method: req.method, url: req.url,
      status: result.response?.status ?? 0,
      ok: result.response?.ok ?? false,
      timeMs: result.response?.timeMs ?? 0,
      error: result.error ?? undefined,
      request: JSON.parse(JSON.stringify(req)) as ApiRequest,
      response: result.response,
      tests: result.tests,
      logs: result.logs,
    }, sensitiveValues);
  }, [store]);

  // Run one request (used by the Runner and the MCP bridge); resolves
  // inherited scripts/auth/envs per id — never
  // `store.activeCollectionEnv`/`store.activeGlobalEnv`, since a caller may
  // run a request outside whatever tab/collection is currently open (a
  // collection-scoped environment must only apply to its own collection's
  // requests; see `getEnvsForRequest` in store.ts). Results are deliberately
  // kept out of History here: a 20-request × 5-iteration Runner pass would
  // otherwise evict every manually-sent entry from the 50-entry log, and the
  // Runner/MCP bridge already keep the full request/response for each of
  // their own runs.
  //
  // `envId` lets a caller pin a specific environment for its own run,
  // independent of whatever is globally active — `undefined` (the normal
  // send path) keeps the normal per-request auto-resolution (both collection
  // and global env); the Runner/MCP bridge always pass a concrete id or
  // `null` ("No Environment"), routed into whichever of the two slots that
  // environment's own scope belongs to (only ever forcing one at a time).
  const runRequest = useCallback(async (req: ApiRequest, dataVars?: VarMap, signal?: AbortSignal, envId?: string | null) => {
    const jar = store.cookiesEnabled ? store.cookies : [];
    let collectionEnv: Environment | null;
    let globalEnv: Environment | null;
    if (envId === undefined) {
      ({ collectionEnv, globalEnv } = store.getEnvsForRequest(req.id));
    } else if (envId === null) {
      collectionEnv = null;
      globalEnv = null;
    } else {
      const forced = store.environments.find((e) => e.id === envId) ?? null;
      collectionEnv = forced?.collectionId ? forced : null;
      globalEnv = forced && !forced.collectionId ? forced : null;
    }
    const result = await executeRequest(req, collectionEnv, globalEnv, signal, store.getInherited(req.id), jar, dataVars, scriptTimeoutRef.current, store.vaultVars, store.getCollectionVars(req.id));
    persistResult(req, collectionEnv, globalEnv, result, false);
    return result;
  }, [store, persistResult]);

  return { runRequest, persistResult, scriptTimeoutRef };
}
