// Shared Mock Server runtime — one `useMockServer()` instance for the whole
// app, provided via context instead of instantiated fresh by MockServer.tsx
// on every mount. Same reasoning as apiclient/mcpRuntimeContext.tsx: with the
// background MCP bridge (Settings → MCP) able to answer calls while the Mock
// Server tool is off-screen, a second independent `useMockServer()` instance
// would race the mounted tool's own `config` (a `usePersistentState`) and
// could silently drop whichever side wrote last. Mounted unconditionally at
// the app root — cheap; it only reconciles the already-running backend
// server's status, it doesn't start one.

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
