// API Client — a Postman/Bruno-style HTTP request workbench.
//
// Layout: collections sidebar | open-request tabs + a resizable split of the
// request builder and response viewer (side-by-side or stacked, toggleable).
// Requests run through the Tauri HTTP plugin on desktop (no CORS) and plain
// fetch on web. Workspace state persists in localStorage; collections import and
// export as Postman v2.1. Requests only fire when the user clicks Send.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { AddressBar } from './AddressBar';
import { RequestPanel, type RequestPanelTab } from './RequestPanel';
import { ResponsePanel } from './ResponsePanel';
import { RequestTabs } from './RequestTabs';
import { HistoryView } from './HistoryView';
import { SplitPane } from '@/components/ui/split-pane';
import { EnvironmentEditor } from './EnvironmentEditor';
import { VaultManager } from './VaultManager';
import { GenerateCodeDialog } from './GenerateCodeDialog';
import { RunnerDialog } from './RunnerDialog';
import { CookieManager } from './CookieManager';
import { RuntimeVarsInspector } from './RuntimeVarsInspector';
import { useApiStore } from './store';
import { executeRequest, errToString } from './engine';
import { isScriptSandboxDegraded, stopScriptSandbox, subscribeSandboxStatus } from './scriptHost';
import { useAppConfig } from '@/contexts/AppConfigContext';
import type { ApiRequest, ApiResponse, Environment, KeyValue, LogEntry, TestResult, VarMap } from './types';
import { buildResolvedVars } from './vars';

export type SplitDirection = 'horizontal' | 'vertical';

// Per-tab run state, keyed by request id, so each open request keeps its own
// response/tests/console/loading independent of the others.
interface RunState {
  response: ApiResponse | null;
  error: string | null;
  sending: boolean;
  tests: TestResult[];
  logs: LogEntry[];
}
const EMPTY_RUN: RunState = { response: null, error: null, sending: false, tests: [], logs: [] };

export function ApiClient() {
  const store = useApiStore();
  const { activeRequest } = store;
  const { config } = useAppConfig();
  // Read through a ref so the send/run callbacks don't churn when unrelated
  // config values change.
  const scriptTimeoutRef = useRef(config.apiClient.scriptTimeoutMs);
  scriptTimeoutRef.current = config.apiClient.scriptTimeoutMs;

  const [runs, setRuns] = useState<Record<string, RunState>>({});
  // Which builder tab (Params / Body / Script / …) each open request was left on,
  // so switching between request tabs returns you to where you were working.
  const [panelTabs, setPanelTabs] = useState<Record<string, RequestPanelTab>>({});
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  // Monotonic per-request send counter. A response is only applied when its
  // token is still the newest for that request, so a slow earlier send can never
  // overwrite the result of the one the user is actually waiting on.
  const runTokens = useRef<Map<string, number>>(new Map());
  const [envOpen, setEnvOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const [runtimeVarsOpen, setRuntimeVarsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [runTarget, setRunTarget] = useState<{ title: string; requests: ApiRequest[]; collectionId: string } | null>(null);
  const [direction, setDirection] = usePersistentState<SplitDirection>(
    'devtool:apiclient:layout:v2', 'horizontal',
  );
  // Split sizes are persisted per axis, so toggling the layout (or reopening the
  // tool) restores the proportions the user set rather than resetting to 50/50.
  const [splitH, setSplitH] = usePersistentState('devtool:apiclient:split:horizontal', 50);
  const [splitV, setSplitV] = usePersistentState('devtool:apiclient:split:vertical', 50);
  const [sidebarWidth, setSidebarWidth] = usePersistentState(
    'devtool:apiclient:sidebarWidth', 288,
  );
  const [resizing, setResizing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Drag the divider between the collections sidebar and the workbench.
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { resizeCleanupRef.current?.(); }, []);

  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    setResizing(true);
    // Suppress text selection and cursor flicker for the duration of the drag.
    document.body.style.setProperty('user-select', 'none');
    document.body.style.setProperty('cursor', 'col-resize');
    const onMove = (ev: PointerEvent) =>
      setSidebarWidth(Math.min(500, Math.max(200, startW + (ev.clientX - startX))));
    const cleanup = () => {
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    function onUp() {
      setResizing(false);
      cleanup();
      resizeCleanupRef.current = null;
    }
    resizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [sidebarWidth, setSidebarWidth]);
  // Session-scoped runtime variables (bru.setVar), cleared on app restart.
  const runtimeVarsRef = useRef<VarMap>({});
  // Bumped whenever runtime vars change so {{var}} highlighting re-resolves
  // (the ref itself is invisible to React's memoization).
  const [runtimeVarsVersion, setRuntimeVarsVersion] = useState(0);

  // Abort all in-flight requests when the component unmounts, and tear down the
  // script sandbox so a stuck script can't keep a core busy after the user has
  // navigated to another tool.
  useEffect(() => () => {
    abortRefs.current.forEach((ctrl) => ctrl.abort());
    abortRefs.current.clear();
    stopScriptSandbox();
  }, []);

  // Reflects whether the script sandbox worker is currently unavailable (scripts
  // then run unsandboxed on the main thread, with no timeout/interrupt).
  const [sandboxDegraded, setSandboxDegraded] = useState(isScriptSandboxDegraded);
  useEffect(() => subscribeSandboxStatus(setSandboxDegraded), []);

  // Migrate the previously-persisted active request into a tab on first load.
  // Guarded by a ref rather than effect deps: `store` is a fresh object on every
  // render, so a dependency on it re-ran this on every keystroke.
  const migratedTab = useRef(false);
  useEffect(() => {
    if (migratedTab.current) return;
    migratedTab.current = true;
    const id = store.activeRequestId;
    if (id && !store.openRequests.some((r) => r.id === id)) store.selectRequest(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop per-tab run state (and remembered editor tab) for requests that are no
  // longer open, so a long session doesn't accumulate every response it ever saw.
  const openIdsKey = store.openRequests.map((r) => r.id).join(',');
  useEffect(() => {
    const open = new Set(openIdsKey ? openIdsKey.split(',') : []);
    const prune = <T,>(prev: Record<string, T>): Record<string, T> => {
      const keys = Object.keys(prev);
      if (keys.every((k) => open.has(k))) return prev;
      const next: Record<string, T> = {};
      for (const k of keys) if (open.has(k)) next[k] = prev[k];
      return next;
    };
    setRuns(prune);
    setPanelTabs(prune);
  }, [openIdsKey]);

  const patchRun = useCallback((id: string, patch: Partial<RunState>) => {
    setRuns((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_RUN), ...patch } }));
  }, []);

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

  // After a run, persist collection-var/env-var/runtime-var changes and
  // (unless suppressed) record a history entry. `collectionEnv`/`globalEnv`
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
    runtimeVarsRef.current = result.runtimeVars;
    setRuntimeVarsVersion((v) => v + 1);
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

  // Run one request (used by the Runner); resolves inherited scripts/auth/envs
  // per id — never `store.activeCollectionEnv`/`store.activeGlobalEnv`, since
  // the Runner may run a collection other than whatever tab/collection is
  // currently open (a collection-scoped environment must only apply to its
  // own collection's requests; see `getEnvsForRequest` in store.ts). Runner
  // results are deliberately kept out of History: a 20-request × 5-iteration
  // run would otherwise evict every manually-sent entry from the 50-entry
  // log, and the Runner already keeps the full request/response for each of
  // its runs.
  //
  // `envId` lets the Runner pin a specific environment for its own run,
  // independent of whatever is globally active — `undefined` (any other
  // caller) keeps the normal per-request auto-resolution (both collection and
  // global env); the Runner always passes a concrete id or `null` ("No
  // Environment"), routed into whichever of the two slots that environment's
  // own scope belongs to (Runner still only ever forces one at a time).
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
    const result = await executeRequest(req, collectionEnv, globalEnv, runtimeVarsRef.current, signal, store.getInherited(req.id), jar, dataVars, scriptTimeoutRef.current, store.vaultVars, store.getCollectionVars(req.id));
    persistResult(req, collectionEnv, globalEnv, result, false);
    return result;
  }, [store, persistResult]);

  const send = useCallback(async () => {
    if (!activeRequest) return;
    const id = activeRequest.id;
    // Replace any send still running for this request rather than orphaning it.
    abortRefs.current.get(id)?.abort();
    const controller = new AbortController();
    abortRefs.current.set(id, controller);
    const token = (runTokens.current.get(id) ?? 0) + 1;
    runTokens.current.set(id, token);
    const isCurrent = () => runTokens.current.get(id) === token;

    patchRun(id, { sending: true, error: null });
    try {
      const jar = store.cookiesEnabled ? store.cookies : [];
      const result = await executeRequest(activeRequest, store.activeCollectionEnv, store.activeGlobalEnv, runtimeVarsRef.current, controller.signal, store.inheritedScripts, jar, {}, scriptTimeoutRef.current, store.vaultVars, store.activeCollectionVars);
      persistResult(activeRequest, store.activeCollectionEnv, store.activeGlobalEnv, result);
      if (!isCurrent()) return;
      patchRun(id, {
        response: result.response,
        error: result.error,
        tests: result.tests,
        logs: result.logs,
      });
    } catch (e) {
      if (!isCurrent()) return;
      if ((e as Error).name === 'AbortError') {
        // Keep the previous response on screen; only note that this run stopped.
        patchRun(id, { error: 'Request cancelled.' });
      } else {
        patchRun(id, { error: errToString(e), response: null, tests: [], logs: [] });
      }
    } finally {
      if (isCurrent()) patchRun(id, { sending: false });
      if (abortRefs.current.get(id) === controller) abortRefs.current.delete(id);
    }
  }, [activeRequest, store, patchRun, persistResult]);

  const cancel = useCallback(() => {
    if (activeRequest) abortRefs.current.get(activeRequest.id)?.abort();
  }, [activeRequest]);

  // Stable refs so the keyboard listener can read current values without being
  // re-registered on every response update (runs changes on every API call, store
  // reference changes on every collection edit — both would cause constant churn).
  const activeRequestRef = useRef(activeRequest);
  activeRequestRef.current = activeRequest;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const sendRef = useRef(send);
  sendRef.current = send;
  const storeRef = useRef(store);
  storeRef.current = store;

  // Global keyboard shortcuts (Bruno parity): ⌘/Ctrl + Enter sends, + B creates a
  // request in the first collection, + E opens the environment manager.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const req = activeRequestRef.current;
      const s = storeRef.current;
      if (e.key === 'Enter') {
        if (req && !runsRef.current[req.id]?.sending) { e.preventDefault(); sendRef.current(); }
      } else if (e.key.toLowerCase() === 'b') {
        const first = s.collections[0];
        if (first) { e.preventDefault(); s.addItem(first.id, 'request'); }
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault(); setEnvOpen(true);
      } else if (e.key.toLowerCase() === 'w') {
        // Always prevent the OS window-close shortcut (⌘W on macOS closes the window
        // when not intercepted). Close the active tab if one is open.
        e.preventDefault();
        if (req) s.closeTab(req.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newRequest = useCallback(() => {
    const first = store.collections[0];
    if (first) { setShowHistory(false); store.addItem(first.id, 'request'); }
  }, [store]);

  // Stable so the Sidebar's memoized tree nodes aren't invalidated each render.
  const handleRun = useCallback((title: string, requests: ApiRequest[], collectionId: string) => {
    setRunTarget({ title, requests, collectionId });
  }, []);

  // Fold Collection Variables, then the Global env, then the Collection env
  // (each overriding the one before it) into `map` — the same precedence
  // engine.ts's real substitution uses, minus the data-file row (not
  // applicable to these UI previews) and runtime (applied separately by each
  // caller below, since only `varMap` needs it merged in for highlighting).
  const foldEnvs = (map: VarMap) => {
    if (store.activeGlobalEnv) for (const v of store.activeGlobalEnv.variables) if (v.enabled && v.key) map[v.key] = v.secret ? '••••••••' : v.value;
    if (store.activeCollectionEnv) for (const v of store.activeCollectionEnv.variables) if (v.enabled && v.key) map[v.key] = v.secret ? '••••••••' : v.value;
  };

  // Merged variable map (collection var + envs + session runtime vars) for
  // code generation. Secret-flagged environment variables are masked here too
  // — a generated snippet is exactly the kind of thing that gets pasted into a
  // chat or a doc, so it must not carry the real value any more than the
  // Vault's entries do.
  const codeVars = useCallback((): VarMap => {
    const vars: VarMap = { ...store.activeCollectionVars };
    foldEnvs(vars);
    Object.assign(vars, runtimeVarsRef.current);
    return vars;
  }, [store.activeCollectionEnv, store.activeGlobalEnv, store.activeCollectionVars]);

  // Known variables (name → current value) for {{ }} highlighting, autocomplete,
  // and hover-value tooltips in inputs.
  const varMap = useMemo(() => {
    const map: VarMap = { ...store.activeCollectionVars };
    foldEnvs(map);
    Object.assign(map, runtimeVarsRef.current);
    if (activeRequest) for (const v of activeRequest.vars.req) if (v.name) map[v.name] = v.value;
    // Vault secrets and secret-flagged environment variables are recognized
    // (for highlight/autocomplete) but their values stay masked in the UI —
    // the real value only reaches the request that's actually sent (see
    // engine.ts's own vault merge, and the env folds above).
    for (const v of store.vault) if (v.enabled && v.key) map[`vault.${v.key}`] = '••••••••';
    return map;
    // runtimeVarsVersion is intentionally a dep: the ref mutates invisibly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activeCollectionEnv, store.activeGlobalEnv, store.activeCollectionVars, store.vault, activeRequest, runtimeVarsVersion]);

  // Runtime vars only (bru.setVar / declarative Vars tab), for the standalone
  // inspector — unlike `varMap` above, this excludes collection/env/vault so
  // it shows exactly what a script could read back with bru.getVar/getVars.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runtimeVars = useMemo(() => ({ ...runtimeVarsRef.current }), [runtimeVarsVersion]);

  // The merged, *source-tagged* variable set — unlike `varMap` (a flat
  // name→value map for {{}} highlighting) this keeps which of the five
  // scattered editors each winning value actually came from, for
  // EnvQuickView's glance-and-deep-link popover. Request-level Vars aren't
  // included — those are edited right there in the open request, not a
  // separate surface. See vars.ts's buildResolvedVars for the merge itself.
  const resolvedVars = useMemo(
    () => buildResolvedVars(store.activeCollectionVars, runtimeVarsRef.current, store.activeCollectionEnv, store.activeGlobalEnv, store.vault),
    // runtimeVarsVersion is intentionally a dep: the ref mutates invisibly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.activeCollectionVars, store.activeCollectionEnv, store.activeGlobalEnv, store.vault, runtimeVarsVersion],
  );

  const run = activeRequest ? (runs[activeRequest.id] ?? EMPTY_RUN) : EMPTY_RUN;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
          <Sidebar store={store} searchInputRef={searchInputRef} onRun={handleRun} />
        </div>
        <div
          onPointerDown={startSidebarResize}
          className={cn(
            'group relative w-px shrink-0 cursor-col-resize bg-line transition-colors hover:bg-acc/40',
            resizing && 'bg-acc/60',
          )}
        >
          {/* wider invisible hit area for easier grabbing */}
          <span className="absolute -inset-x-1 inset-y-0" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <RequestTabs
            store={store}
            runs={runs}
            direction={direction}
            onToggleDirection={() => setDirection((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'))}
            onNewRequest={newRequest}
            onManageEnvironments={() => setEnvOpen(true)}
            onManageVault={() => setVaultOpen(true)}
            onRuntimeVars={() => setRuntimeVarsOpen(true)}
            resolvedVars={resolvedVars}
            historyActive={showHistory}
            onSelectRequest={(id) => { setShowHistory(false); store.setActiveRequestId(id); }}
            onOpenHistory={() => setShowHistory(true)}
            onCloseHistory={() => setShowHistory(false)}
          />
          {showHistory ? (
            <HistoryView store={store} onExit={() => setShowHistory(false)} />
          ) : activeRequest ? (
            <>
              <AddressBar
                request={activeRequest}
                onChange={(patch) => store.updateRequest(activeRequest.id, patch)}
                onSend={send}
                onCancel={cancel}
                onRename={(name) => store.renameItem(activeRequest.id, name)}
                sending={run.sending}
                onGenerateCode={() => setCodeOpen(true)}
                vars={varMap}
              />
              <SplitPane
                direction={direction}
                minPanePx={direction === 'horizontal' ? 380 : 220}
                percent={direction === 'horizontal' ? splitH : splitV}
                onPercentChange={direction === 'horizontal' ? setSplitH : setSplitV}
                first={
                  <RequestPanel
                    key={activeRequest.id}
                    request={activeRequest}
                    onChange={(patch) => store.updateRequest(activeRequest.id, patch)}
                    vars={varMap}
                    tab={panelTabs[activeRequest.id] ?? 'params'}
                    onTabChange={(t) => setPanelTabs((prev) => ({ ...prev, [activeRequest.id]: t }))}
                  />
                }
                second={
                  <ResponsePanel
                    response={run.response}
                    sending={run.sending}
                    error={run.error}
                    tests={run.tests}
                    logs={run.logs}
                    onClear={() => setRuns((prev) => ({ ...prev, [activeRequest.id]: EMPTY_RUN }))}
                    onJumpToTab={(t) => setPanelTabs((prev) => ({ ...prev, [activeRequest.id]: t }))}
                    onJumpToSettings={() => setPanelTabs((prev) => ({ ...prev, [activeRequest.id]: 'settings' }))}
                    request={activeRequest}
                  />
                }
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-mute motion-safe:animate-fade-in-up">
              <Send className="h-10 w-10 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium text-fg/70">No request open</p>
                <p className="mt-1 text-xs">Select a request from the sidebar, or press <kbd className="rounded border bg-bg-2 px-1.5 py-0.5 font-mono text-[11px]">⌘B</kbd> to create one.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <StatusBar
        onSearch={() => searchInputRef.current?.focus()}
        onCookies={() => setCookiesOpen(true)}
        cookieCount={store.cookies.length}
        onRuntimeVars={() => setRuntimeVarsOpen(true)}
        runtimeVarCount={Object.keys(runtimeVars).length}
        sandboxDegraded={sandboxDegraded}
      />

      <EnvironmentEditor store={store} open={envOpen} onClose={() => setEnvOpen(false)} />
      <VaultManager store={store} open={vaultOpen} onClose={() => setVaultOpen(false)} />
      <CookieManager store={store} open={cookiesOpen} onClose={() => setCookiesOpen(false)} />
      <RuntimeVarsInspector vars={runtimeVars} open={runtimeVarsOpen} onClose={() => setRuntimeVarsOpen(false)} />
      <GenerateCodeDialog
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        request={activeRequest}
        vars={codeOpen ? codeVars() : {}}
        inheritedHeaders={activeRequest ? store.getInherited(activeRequest.id).headers : []}
      />
      {runTarget && (
        <RunnerDialog
          open
          title={runTarget.title}
          requests={runTarget.requests}
          runRequest={runRequest}
          knownVars={Object.keys(varMap)}
          onClose={() => setRunTarget(null)}
          environments={store.environments.filter((e) => !e.collectionId || e.collectionId === runTarget.collectionId)}
          defaultEnvId={store.activeCollectionEnv?.id ?? store.activeGlobalEnv?.id ?? null}
        />
      )}
    </div>
  );
}
