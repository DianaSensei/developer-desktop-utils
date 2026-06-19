// API Client — a Postman/Bruno-style HTTP request workbench.
//
// Layout: collections sidebar | open-request tabs + a resizable split of the
// request builder and response viewer (side-by-side or stacked, toggleable).
// Requests run through the Tauri HTTP plugin on desktop (no CORS) and plain
// fetch on web. Workspace state persists in localStorage; collections import and
// export as Postman v2.1. Requests only fire when the user clicks Send.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { Sidebar } from './Sidebar';
import { RequestPanel } from './RequestPanel';
import { ResponsePanel } from './ResponsePanel';
import { RequestTabs } from './RequestTabs';
import { SplitPane } from './SplitPane';
import { EnvironmentEditor } from './EnvironmentEditor';
import { useApiStore } from './store';
import { executeRequest } from './engine';
import { toCurl } from './request';
import type { ApiResponse, LogEntry, TestResult, VarMap } from './types';

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
  const [direction, setDirection] = usePersistentState<SplitDirection>(
    'devtool:apiclient:layout', 'vertical',
  );
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

  const send = useCallback(async () => {
    if (!activeRequest) return;
    const id = activeRequest.id;
    const controller = new AbortController();
    abortRefs.current.set(id, controller);
    patchRun(id, { sending: true, error: null });
    try {
      const result = await executeRequest(activeRequest, store.activeEnv, runtimeVarsRef.current, controller.signal, store.inheritedScripts);
      runtimeVarsRef.current = result.runtimeVars;
      // Persist any environment vars a script changed (bru.setEnvVar).
      if (result.envChanged && store.activeEnv) {
        const env = store.activeEnv;
        const variables = env.variables.map((v) =>
          v.key in result.envVars ? { ...v, value: result.envVars[v.key] } : v,
        );
        const existing = new Set(env.variables.map((v) => v.key));
        for (const [k, val] of Object.entries(result.envVars)) {
          if (!existing.has(k)) variables.push({ id: `s-${Date.now()}-${k}`, key: k, value: val, enabled: true });
        }
        store.updateEnvironment(env.id, { variables });
      }
      patchRun(id, {
        response: result.response,
        error: result.error,
        tests: result.tests,
        logs: result.logs,
      });
      store.addHistory({
        method: activeRequest.method, url: activeRequest.url,
        status: result.response?.status ?? 0,
        ok: result.response?.ok ?? false,
        timeMs: result.response?.timeMs ?? 0,
        error: result.error ?? undefined,
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
  }, [activeRequest, store, patchRun]);

  const cancel = useCallback(() => {
    if (activeRequest) abortRefs.current.get(activeRequest.id)?.abort();
  }, [activeRequest]);

  const getCurl = useCallback(() => {
    if (!activeRequest) return '';
    const env = store.activeEnv;
    const vars: VarMap = { ...runtimeVarsRef.current };
    if (env) for (const v of env.variables) if (v.enabled && v.key) vars[v.key] = v.value;
    return toCurl(activeRequest, vars);
  }, [activeRequest, store.activeEnv]);

  const run = activeRequest ? (runs[activeRequest.id] ?? EMPTY_RUN) : EMPTY_RUN;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <Sidebar store={store} onManageEnvironments={() => setEnvOpen(true)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeRequest ? (
          <>
            <RequestTabs
              store={store}
              direction={direction}
              onToggleDirection={() => setDirection((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'))}
            />
            <SplitPane
              direction={direction}
              first={
                <RequestPanel
                  key={activeRequest.id}
                  request={activeRequest}
                  onChange={(patch) => store.updateRequest(activeRequest.id, patch)}
                  onSend={send}
                  onCancel={cancel}
                  sending={run.sending}
                  getCurl={getCurl}
                />
              }
              second={<ResponsePanel response={run.response} sending={run.sending} error={run.error} tests={run.tests} logs={run.logs} />}
            />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Send className="h-8 w-8 opacity-30" />
            <p className="text-sm">Select a request, or create one with the + button.</p>
          </div>
        )}
      </div>

      <EnvironmentEditor store={store} open={envOpen} onClose={() => setEnvOpen(false)} />
    </div>
  );
}
