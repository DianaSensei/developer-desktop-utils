// Shared Kafka Explorer runtime — one `useKafkaState()` instance for the
// whole app, provided via context instead of instantiated fresh by
// KafkaExplorer.tsx on every mount. Same reasoning as
// apiclient/mcpRuntimeContext.tsx / redis/mcpRuntimeContext.tsx: with the
// background MCP bridge (Settings → MCP) able to answer calls while the
// Kafka Explorer tool is off-screen, a second independent `useKafkaState()`
// instance would race the mounted tool's own `connectedBrokerId`/
// `selectedBrokerId` (each a `usePersistentState`) and could silently drop
// whichever side wrote last. Mounted unconditionally at the app root —
// cheap, since `useKafkaState()` does no I/O beyond an initial localStorage
// read.

import { createContext, useContext, type ReactNode } from 'react';
import { useKafkaState, type KafkaState } from './useKafkaState';

const KafkaRuntimeContext = createContext<KafkaState | null>(null);

export function KafkaRuntimeProvider({ children }: { children: ReactNode }) {
  const state = useKafkaState();
  return (
    <KafkaRuntimeContext.Provider value={state}>
      {children}
    </KafkaRuntimeContext.Provider>
  );
}

export function useKafkaRuntime(): KafkaState {
  const ctx = useContext(KafkaRuntimeContext);
  if (!ctx) throw new Error('useKafkaRuntime must be used within KafkaRuntimeProvider');
  return ctx;
}
