// One shared `useMockServer()` instance for the whole app, mounted at the root.
// Same reason as apiclient/mcpRuntimeContext.tsx: a second instance alongside
// the background MCP bridge would race the tool's persisted `config`.

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { liveConnections } from '@/lib/liveConnections';
import { useMockServer, type MockServerState } from './useMockServer';

const MockServerRuntimeContext = createContext<MockServerState | null>(null);

export function MockServerRuntimeProvider({ children }: { children: ReactNode }) {
  const mockServer = useMockServer();
  // A server left running keeps listening on a port whichever tool is open:
  // show the green "running" dot on its sidebar entry and tab.
  const running = mockServer.status.running;
  useEffect(() => {
    liveConnections.set('mock-server', running);
  }, [running]);
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
