// Shared Container Manager runtime — one `useContainerState()` instance for
// the whole app, provided via context instead of instantiated fresh by
// ContainerManager.tsx on every mount. Same reasoning as
// apiclient/mcpRuntimeContext.tsx / redis / kafka / rabbit's equivalents:
// with the background MCP bridge (Settings → MCP) able to answer calls
// while the Containers tool is off-screen, a second independent
// `useContainerState()` instance would race the mounted tool's own
// `connectedConnId`/`selectedConnId` (each a `usePersistentState`) and
// could silently drop whichever side wrote last. Mounted unconditionally at
// the app root — cheap, since `useContainerState()` does no I/O beyond an
// initial localStorage read.

import { createContext, useContext, type ReactNode } from 'react';
import { useContainerState, type ContainerToolState } from './useContainerState';

const ContainerRuntimeContext = createContext<ContainerToolState | null>(null);

export function ContainerRuntimeProvider({ children }: { children: ReactNode }) {
  const state = useContainerState();
  return (
    <ContainerRuntimeContext.Provider value={state}>
      {children}
    </ContainerRuntimeContext.Provider>
  );
}

export function useContainerRuntime(): ContainerToolState {
  const ctx = useContext(ContainerRuntimeContext);
  if (!ctx) throw new Error('useContainerRuntime must be used within ContainerRuntimeProvider');
  return ctx;
}
