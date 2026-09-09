// Shared RabbitMQ Client runtime — one `useRabbitState()` instance for the
// whole app, provided via context instead of instantiated fresh by
// RabbitClient.tsx on every mount. Same reasoning as
// apiclient/mcpRuntimeContext.tsx / redis/mcpRuntimeContext.tsx /
// kafka/mcpRuntimeContext.tsx: with the background MCP bridge (Settings →
// MCP) able to answer calls while the RabbitMQ Client tool is off-screen, a
// second independent `useRabbitState()` instance would race the mounted
// tool's own `connectedConnId`/`selectedConnId` (each a `usePersistentState`)
// and could silently drop whichever side wrote last. Mounted unconditionally
// at the app root — cheap, since `useRabbitState()` does no I/O beyond an
// initial localStorage read.

import { createContext, useContext, type ReactNode } from 'react';
import { useRabbitState, type RabbitState } from './useRabbitState';

const RabbitRuntimeContext = createContext<RabbitState | null>(null);

export function RabbitRuntimeProvider({ children }: { children: ReactNode }) {
  const state = useRabbitState();
  return (
    <RabbitRuntimeContext.Provider value={state}>
      {children}
    </RabbitRuntimeContext.Provider>
  );
}

export function useRabbitRuntime(): RabbitState {
  const ctx = useContext(RabbitRuntimeContext);
  if (!ctx) throw new Error('useRabbitRuntime must be used within RabbitRuntimeProvider');
  return ctx;
}
