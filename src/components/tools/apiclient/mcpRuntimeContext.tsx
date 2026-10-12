// One shared `useApiStore()` instance for the whole app, mounted at the root
// (App.tsx). ApiClient.tsx and the background MCP bridge both read it through
// `useApiClientRuntime()`; two independent instances would each write their
// own stale localStorage snapshot and silently drop the other's changes.

import { createContext, useContext, type ReactNode } from 'react';
import { usePluginConfig } from '@/platform';
import { useApiStore, type ApiStore } from './store';
import { useApiRunner } from './useApiRunner';
import type { RunRequestFn } from './mcpBridge';

interface ApiClientRuntime {
  store: ApiStore;
  runRequest: RunRequestFn;
  persistResult: ReturnType<typeof useApiRunner>['persistResult'];
}

const ApiClientRuntimeContext = createContext<ApiClientRuntime | null>(null);

export function ApiClientRuntimeProvider({ children }: { children: ReactNode }) {
  const store = useApiStore();
  const config = usePluginConfig();
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
