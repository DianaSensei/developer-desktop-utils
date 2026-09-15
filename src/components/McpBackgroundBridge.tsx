// Keeps every connection-based tool's MCP bridge answering `mcp:call`
// events while that tool isn't on screen — opt-in via Settings → MCP
// (`useMcpBackgroundBridge`, off by default per the "no silent network
// calls" rule). Mounted once at the app root (App.tsx), inside every
// runtime provider so it shares the exact same store/state instances the
// tool components read when they're open — see apiclient/mcpRuntimeContext.tsx
// and mockserver/mcpRuntimeContext.tsx for why that sharing matters.
//
// redis-client/rabbit-client/container-manager/kafka-explorer moved to
// developer-desktop-util-plugin (see
// docs/decisions/architecture/optional-broker-plugins.md) and no longer
// have a background bridge here: an externally-installed plugin only mounts
// when its own route is visited, so there's no compile-time runtime context
// to share while it's off-screen. Their MCP tool definitions still exist in
// devtool-mcp-server.rs (bundled with those plugins, registered dynamically
// when installed); calls to them simply go unanswered unless the plugin's
// own route is open.
//
// The stateless utility tools (Encode·Hash·Encrypt, JWT Debugger, JSON
// Formatter) do NOT need this — see McpUtilityBridge.tsx, mounted
// separately and unconditionally, for why.
//
// Renders nothing; it exists purely to hold the `useMcpBridge` calls. When
// the background setting is off, all of them are still called (rules of
// hooks) but with `enabled=false`, so none registers a Tauri listener. Each
// call is additionally gated by that tool's own per-tool MCP toggle
// (useMcpToolEnabled, Settings → MCP) — a tool switched off there never
// answers here either, background bridge or not.

import { useMcpBridge as useApiClientMcpBridge } from './tools/apiclient/mcpBridge';
import { useApiClientRuntime } from './tools/apiclient/mcpRuntimeContext';
import { useMcpBridge as useMockServerMcpBridge } from './tools/mockserver/mcpBridge';
import { useMockServerRuntime } from './tools/mockserver/mcpRuntimeContext';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { useMcpToolEnabledMap } from '@/hooks/useMcpToolEnabled';

export function McpBackgroundBridge() {
  const { enabled } = useMcpBackgroundBridge();
  const { isEnabled } = useMcpToolEnabledMap();
  const { store, runRequest } = useApiClientRuntime();
  const mockServer = useMockServerRuntime();

  useApiClientMcpBridge(store, runRequest, enabled && isEnabled('api-client'));
  useMockServerMcpBridge(mockServer, enabled && isEnabled('mock-server'));

  return null;
}
