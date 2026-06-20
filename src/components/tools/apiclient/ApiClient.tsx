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
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { AddressBar } from './AddressBar';
import { RequestPanel } from './RequestPanel';
import { ResponsePanel } from './ResponsePanel';
import { RequestTabs } from './RequestTabs';
import { HistoryView } from './HistoryView';
import { SplitPane } from './SplitPane';
import { EnvironmentEditor } from './EnvironmentEditor';
import { GenerateCodeDialog } from './GenerateCodeDialog';
import { RunnerDialog } from './RunnerDialog';
import { useApiStore } from './store';
import { executeRequest } from './engine';
import type { ApiRequest, ApiResponse, LogEntry, TestResult, VarMap } from './types';

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

  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  const [envOpen, setEnvOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [runTarget, setRunTarget] = useState<{ title: string; requests: ApiRequest[] } | null>(null);
  const [direction, setDirection] = usePersistentState<SplitDirection>(
    'devtool:apiclient:layout:v2', 'horizontal',
  );
  const [sidebarWidth, setSidebarWidth] = usePersistentState(
    'devtool:apiclient:sidebarWidth', 288,
  );
  const [resizing, setResizing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Drag the divider between the collections sidebar and the workbench.
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    setResizing(true);
    const onMove = (ev: PointerEvent) =>
      setSidebarWidth(Math.min(500, Math.max(200, startW + (ev.clientX - startX))));
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [sidebarWidth, setSidebarWidth]);
  // Session-scoped runtime variables (bru.setVar), cleared on app restart.
  const runtimeVarsRef = useRef<VarMap>({});

  // Migrate the previously-persisted active request into a tab on first load.
  useEffect(() => {
    if (activeRequest && !store.openRequests.some((r) => r.id === activeRequest.id)) {
      store.selectRequest(activeRequest.id);
    }
  }, [activeRequest, store]);

  const patchRun = useCallback((id: string, patch: Partial<RunState>) => {
    setRuns((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_RUN), ...patch } }));
  }, []);

  // After a run, persist runtime/env-var changes and record a history entry.
  const persistResult = useCallback((req: ApiRequest, result: Awaited<ReturnType<typeof executeRequest>>) => {
    runtimeVarsRef.current = result.runtimeVars;
    if (result.envChanged && store.activeEnv) {
      const env = store.activeEnv;
      const variables = env.variables.map((v) => (v.key in result.envVars ? { ...v, value: result.envVars[v.key] } : v));
      const existing = new Set(env.variables.map((v) => v.key));
      for (const [k, val] of Object.entries(result.envVars)) {
        if (!existing.has(k)) variables.push({ id: `s-${Date.now()}-${k}`, key: k, value: val, enabled: true });
      }
      store.updateEnvironment(env.id, { variables });
    }
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
    });
  }, [store]);

  // Run one request (used by the Runner); resolves inherited scripts/auth per id.
  const runRequest = useCallback(async (req: ApiRequest) => {
    const result = await executeRequest(req, store.activeEnv, runtimeVarsRef.current, undefined, store.getInherited(req.id));
    persistResult(req, result);
    return result;
  }, [store, persistResult]);

  const send = useCallback(async () => {
    if (!activeRequest) return;
    const id = activeRequest.id;
    const controller = new AbortController();
    abortRefs.current.set(id, controller);
    patchRun(id, { sending: true, error: null });
    try {
      const result = await executeRequest(activeRequest, store.activeEnv, runtimeVarsRef.current, controller.signal, store.inheritedScripts);
      persistResult(activeRequest, result);
      patchRun(id, {
        response: result.response,
        error: result.error,
        tests: result.tests,
        logs: result.logs,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        patchRun(id, { error: 'Request cancelled.' });
      } else {
        patchRun(id, { error: (e as Error).message || 'Request failed', response: null });
      }
    } finally {
      patchRun(id, { sending: false });
      abortRefs.current.delete(id);
    }
  }, [activeRequest, store, patchRun, persistResult]);

  const cancel = useCallback(() => {
    if (activeRequest) abortRefs.current.get(activeRequest.id)?.abort();
  }, [activeRequest]);

  // Global keyboard shortcuts (Bruno parity): ⌘/Ctrl + Enter sends, + B creates a
  // request in the first collection, + E opens the environment manager.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'Enter') {
        if (activeRequest && !runs[activeRequest.id]?.sending) { e.preventDefault(); send(); }
      } else if (e.key.toLowerCase() === 'b') {
        const first = store.collections[0];
        if (first) { e.preventDefault(); store.addItem(first.id, 'request'); }
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault(); setEnvOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeRequest, runs, send, store]);

  const newRequest = useCallback(() => {
    const first = store.collections[0];
    if (first) { setShowHistory(false); store.addItem(first.id, 'request'); }
  }, [store]);

  // Merged variable map (environment + session runtime vars) for code generation.
  const codeVars = useCallback((): VarMap => {
    const env = store.activeEnv;
    const vars: VarMap = { ...runtimeVarsRef.current };
    if (env) for (const v of env.variables) if (v.enabled && v.key) vars[v.key] = v.value;
    return vars;
  }, [store.activeEnv]);

  // Known variables (name → current value) for {{ }} highlighting, autocomplete,
  // and hover-value tooltips in inputs.
  const varMap = useMemo(() => {
    const map: VarMap = { ...runtimeVarsRef.current };
    if (store.activeEnv) for (const v of store.activeEnv.variables) if (v.enabled && v.key) map[v.key] = v.value;
    if (activeRequest) for (const v of activeRequest.vars.req) if (v.name) map[v.name] = v.value;
    return map;
  }, [store.activeEnv, activeRequest]);

  const run = activeRequest ? (runs[activeRequest.id] ?? EMPTY_RUN) : EMPTY_RUN;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
          <Sidebar store={store} searchInputRef={searchInputRef} onRun={(title, requests) => setRunTarget({ title, requests })} />
        </div>
        <div
          onPointerDown={startSidebarResize}
          className={cn(
            'group relative w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40',
            resizing && 'bg-primary/60',
          )}
        >
          {/* wider invisible hit area for easier grabbing */}
          <span className="absolute -inset-x-1 inset-y-0" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar store={store} onManageEnvironments={() => setEnvOpen(true)} />
          {activeRequest || showHistory ? (
            <>
              <RequestTabs
                store={store}
                direction={direction}
                onToggleDirection={() => setDirection((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'))}
                onNewRequest={newRequest}
                historyActive={showHistory}
                onSelectRequest={(id) => { setShowHistory(false); store.setActiveRequestId(id); }}
                onOpenHistory={() => setShowHistory(true)}
                onCloseHistory={() => setShowHistory(false)}
              />
              {showHistory ? (
                <HistoryView store={store} />
              ) : activeRequest ? (
                <>
                  <AddressBar
                    request={activeRequest}
                    onChange={(patch) => store.updateRequest(activeRequest.id, patch)}
                    onSend={send}
                    onCancel={cancel}
                    sending={run.sending}
                    onGenerateCode={() => setCodeOpen(true)}
                    vars={varMap}
                  />
                  <SplitPane
                    direction={direction}
                    minPanePx={direction === 'horizontal' ? 380 : 220}
                    first={
                      <RequestPanel
                        key={activeRequest.id}
                        request={activeRequest}
                        onChange={(patch) => store.updateRequest(activeRequest.id, patch)}
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
                      />
                    }
                  />
                </>
              ) : null}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Send className="h-8 w-8 opacity-30" />
              <p className="text-sm">Select a request, or create one with the + button.</p>
            </div>
          )}
        </div>
      </div>

      <StatusBar onSearch={() => searchInputRef.current?.focus()} />

      <EnvironmentEditor store={store} open={envOpen} onClose={() => setEnvOpen(false)} />
      <GenerateCodeDialog
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        request={activeRequest}
        vars={codeOpen ? codeVars() : {}}
      />
      {runTarget && (
        <RunnerDialog
          open
          title={runTarget.title}
          requests={runTarget.requests}
          runRequest={runRequest}
          onClose={() => setRunTarget(null)}
        />
      )}
    </div>
  );
}
