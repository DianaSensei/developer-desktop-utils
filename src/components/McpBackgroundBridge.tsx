// Keeps the API Client and Mock Server MCP bridges answering `mcp:call`
// events while neither tool is on screen — opt-in via Settings → MCP
// (`useMcpBackgroundBridge`, off by default per the "no silent network
// calls" rule). Mounted once at the app root (App.tsx), inside both runtime
// providers so it shares the exact same `store`/`mockServer` instances the
// tool components read when they're open — see apiclient/mcpRuntimeContext.tsx
// and mockserver/mcpRuntimeContext.tsx for why that sharing matters.
//
// Renders nothing; it exists purely to hold the two `useMcpBridge` calls.
// When the setting is off, both are still called (rules of hooks) but with
// `enabled=false`, so neither registers a Tauri listener.

import { useMcpBridge as useApiClientMcpBridge } from './tools/apiclient/mcpBridge';
import { useApiClientRuntime } from './tools/apiclient/mcpRuntimeContext';
import { useMcpBridge as useMockServerMcpBridge } from './tools/mockserver/mcpBridge';
import { useMockServerRuntime } from './tools/mockserver/mcpRuntimeContext';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';

export function McpBackgroundBridge() {
  const { enabled } = useMcpBackgroundBridge();
  const { store, runRequest } = useApiClientRuntime();
  const mockServer = useMockServerRuntime();

  useApiClientMcpBridge(store, runRequest, enabled);
  useMockServerMcpBridge(mockServer, enabled);

  return null;
}
