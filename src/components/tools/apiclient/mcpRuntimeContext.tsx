// Shared API Client runtime — one `useApiStore()` instance for the whole app,
// provided via context instead of instantiated fresh by ApiClient.tsx on
// every mount.
//
// Why this exists: `useApiStore()`/`useApiRunner()` back every field with
// `usePersistentState`, which reads localStorage once at mount and writes the
// *entire* serialized value back on every change. Before the background MCP
// bridge (Settings → MCP, see McpBackgroundBridge.tsx), only one instance was
// ever alive: React Router unmounts ApiClient.tsx when you navigate away, so
// there was nothing else running to diverge from. With the background bridge
// able to answer MCP calls while the API Client tool is either on- or
// off-screen, a *second* independent instance mounted at the same time would
// race the first — a UI edit and a concurrent MCP edit could each overwrite
// localStorage with their own stale snapshot of everything else, silently
// discarding the other's change. Mounting the store once here and having
// both ApiClient.tsx and McpBackgroundBridge.tsx read it through
// `useApiClientRuntime()` keeps there being exactly one source of truth.
//
// The provider itself is mounted unconditionally at the app root (App.tsx) —
// cheap, since `useApiStore()` does no I/O beyond the initial localStorage
// read — so the same instance is there whether or not the background bridge
// setting is on.

import { createContext, useContext, type ReactNode } from 'react';
import { useApiStore, type ApiStore } from './store';
import { useApiRunner } from './useApiRunner';
import { useAppConfig } from '@/contexts/AppConfigContext';
import type { RunRequestFn } from './mcpBridge';

interface ApiClientRuntime {
  store: ApiStore;
  runRequest: RunRequestFn;
  persistResult: ReturnType<typeof useApiRunner>['persistResult'];
}

const ApiClientRuntimeContext = createContext<ApiClientRuntime | null>(null);

export function ApiClientRuntimeProvider({ children }: { children: ReactNode }) {
  const store = useApiStore();
  const { config } = useAppConfig();
  const { runRequest, persistResult } = useApiRunner(store, config.apiClient.scriptTimeoutMs);

  return (
    <ApiClientRuntimeContext.Provider value={{ store, runRequest, persistResult }}>
      {children}
    </ApiClientRuntimeContext.Provider>
  );
}

export function useApiClientRuntime(): ApiClientRuntime {
  const ctx = useContext(ApiClientRuntimeContext);
  if (!ctx) throw new Error('useApiClientRuntime must be used within ApiClientRuntimeProvider');
  return ctx;
}
