// One shared `useMockServer()` instance for the whole app, mounted at the root.
// Same reason as apiclient/mcpRuntimeContext.tsx: a second instance alongside
// the background MCP bridge would race the tool's persisted `config`.

import { createContext, useContext, type ReactNode } from 'react';
import { useMockServer, type MockServerState } from './useMockServer';

const MockServerRuntimeContext = createContext<MockServerState | null>(null);

export function MockServerRuntimeProvider({ children }: { children: ReactNode }) {
  const mockServer = useMockServer();
  return (
    <MockServerRuntimeContext.Provider value={mockServer}>
      {children}
    </MockServerRuntimeContext.Provider>
  );
}

export function useMockServerRuntime(): MockServerState {
  const ctx = useContext(MockServerRuntimeContext);
  if (!ctx) throw new Error('useMockServerRuntime must be used within MockServerRuntimeProvider');
  return ctx;
}
