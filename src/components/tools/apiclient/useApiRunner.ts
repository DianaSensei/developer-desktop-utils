// Shared request-running logic for the API Client, instantiated once at the
// app root (`mcpRuntimeContext.tsx`) so the tool UI and background MCP calls
// share the same `store` and `runRequest`/`persistResult`. Two instances
// against different stores would overwrite each other's saved state (see
// mcpRuntimeContext.tsx).

import { useCallback, useRef } from 'react';
import type { ApiStore } from './store';
import { executeRequest } from './engine';
import type { ApiRequest, Environment, KeyValue, VarMap } from './types';

/** Literal values that must never leave the app in plaintext: vault values
 *  and secret-flagged variables of the environments a run used. */
export function sensitiveValuesFor(
  vaultVars: Record<string, string>,
  collectionEnv: Environment | null,
  globalEnv: Environment | null,
): string[] {
  const secretEnvValues = [...(collectionEnv?.variables ?? []), ...(globalEnv?.variables ?? [])]
    .filter((v) => v.secret && v.value).map((v) => v.value);
  return [...Object.values(vaultVars), ...secretEnvValues];
}

export interface RunOptions {
  /** Record the run in History (MCP runs do; the Runner keeps its own log). */
  recordHistory?: boolean;
}

export function useApiRunner(store: ApiStore, scriptTimeoutMs: number) {
  // A Runner pass or an MCP call outlives the render it started in: reading
  // the store through a ref lets each request see what the previous one
  // wrote (a login script's token), instead of the snapshot from the click.
  const storeRef = useRef(store);
  storeRef.current = store;

  // What the last runs wrote, until the store re-renders with it. A Runner
  // pass can start the next request before React has rendered the previous
  // one's update, so env and collection-variable writes are also kept here.
  const pendingEnvs = useRef(new Map<string, Environment>());
  const pendingCollectionVars = useRef(new Map<string, KeyValue[]>());
  const seenEnvironments = useRef(store.environments);
  const seenCollections = useRef(store.collections);
  if (seenEnvironments.current !== store.environments) {
    seenEnvironments.current = store.environments;
    pendingEnvs.current.clear();
  }
  if (seenCollections.current !== store.collections) {
    seenCollections.current = store.collections;
    pendingCollectionVars.current.clear();
  }
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
    const store = storeRef.current;
    // Capture any Set-Cookie into the jar (scoped to the URL that returned them).
    if (store.cookiesEnabled && result.response?.setCookies?.length) {
      store.captureCookies(result.response.url ?? req.url, result.response.setCookies);
    }
    if (result.collectionEnvChanged && collectionEnv) {
      const variables = mergeVarsIntoRows(collectionEnv.variables, result.collectionEnvVars);
      pendingEnvs.current.set(collectionEnv.id, { ...collectionEnv, variables });
      store.updateEnvironment(collectionEnv.id, { variables });
    }
    if (result.globalEnvChanged && globalEnv) {
      const variables = mergeVarsIntoRows(globalEnv.variables, result.globalEnvVars);
      pendingEnvs.current.set(globalEnv.id, { ...globalEnv, variables });
      store.updateEnvironment(globalEnv.id, { variables });
    }
    if (result.collectionVarsChanged) {
      const owningCollectionId = store.getOwningCollectionId(req.id);
      const collection = owningCollectionId ? store.collections.find((c) => c.id === owningCollectionId) : null;
      if (owningCollectionId && collection) {
        const rows = mergeVarsIntoRows(
          pendingCollectionVars.current.get(owningCollectionId) ?? collection.variables ?? [],
          result.collectionVars,
        );
        pendingCollectionVars.current.set(owningCollectionId, rows);
        store.setCollectionVariables(owningCollectionId, rows);
      }
    }
    if (!recordHistory) return;
    // Values that must never be persisted in plaintext if the server happened
    // to echo them back in the response (see redactText in store.ts). Secret-
    // flagged environment variables get the same treatment as vault values.
    const sensitiveValues = sensitiveValuesFor(store.vaultVars, collectionEnv, globalEnv);
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
  }, []);

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
  const runRequest = useCallback(async (
    req: ApiRequest,
    dataVars?: VarMap,
    signal?: AbortSignal,
    envId?: string | null,
    options: RunOptions = {},
  ) => {
    const store = storeRef.current;
    const jar = store.cookiesEnabled ? store.cookies : [];
    let { collectionEnv, globalEnv } = store.getEnvsForRequest(req.id);
    if (envId === null) {
      collectionEnv = null;
      globalEnv = null;
    } else if (envId !== undefined) {
      const forced = store.environments.find((e) => e.id === envId);
      if (!forced) throw new Error(`No environment with id "${envId}"`);
      // Pin the chosen environment in its own scope; the other scope keeps
      // its normal resolution, as a plain Send would.
      if (forced.collectionId) collectionEnv = forced;
      else globalEnv = forced;
    }
    const latest = (env: Environment | null) => (env ? pendingEnvs.current.get(env.id) ?? env : null);
    collectionEnv = latest(collectionEnv);
    globalEnv = latest(globalEnv);
    let collectionVars = store.getCollectionVars(req.id);
    const owningId = store.getOwningCollectionId(req.id);
    const pendingRows = owningId ? pendingCollectionVars.current.get(owningId) : undefined;
    if (pendingRows) {
      collectionVars = Object.fromEntries(pendingRows.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]));
    }
    const result = await executeRequest(req, collectionEnv, globalEnv, signal, store.getInherited(req.id), jar, dataVars, scriptTimeoutRef.current, store.vaultVars, collectionVars);
    persistResult(req, collectionEnv, globalEnv, result, options.recordHistory ?? false);
    return { ...result, sensitiveValues: sensitiveValuesFor(store.vaultVars, collectionEnv, globalEnv) };
  }, [persistResult]);

  return { runRequest, persistResult, scriptTimeoutRef };
}
