// Shared Redis Client runtime — one `useRedisState()` instance for the whole
// app, provided via context instead of instantiated fresh by RedisClient.tsx
// on every mount. Same reasoning as apiclient/mcpRuntimeContext.tsx: with the
// background MCP bridge (Settings → MCP) able to answer calls while the
// Redis Client tool is off-screen, a second independent `useRedisState()`
// instance would race the mounted tool's own `connectedConnId`/`selectedConnId`/
// `db` (each a `usePersistentState`) and could silently drop whichever side
// wrote last. Mounted unconditionally at the app root — cheap, since
// `useRedisState()` does no I/O beyond an initial localStorage read.

import { createContext, useContext, type ReactNode } from 'react';
import { useRedisState, type RedisState } from './useRedisState';

const RedisRuntimeContext = createContext<RedisState | null>(null);

export function RedisRuntimeProvider({ children }: { children: ReactNode }) {
  const state = useRedisState();
  return (
    <RedisRuntimeContext.Provider value={state}>
      {children}
    </RedisRuntimeContext.Provider>
  );
}

export function useRedisRuntime(): RedisState {
  const ctx = useContext(RedisRuntimeContext);
  if (!ctx) throw new Error('useRedisRuntime must be used within RedisRuntimeProvider');
  return ctx;
}
