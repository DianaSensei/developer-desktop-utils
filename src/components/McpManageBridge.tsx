// MCP bridge — DevTool management tools.
//
// A third `mcp:call` listener, mounted unconditionally at the app root
// (App.tsx) alongside McpBackgroundBridge — unlike the API Client / Mock
// Server / Redis / Kafka bridges, it is never gated by the "Background MCP
// bridge" setting OR the per-tool toggles, since its whole purpose is to
// let an MCP client query and control those settings (and the rest of the
// MCP surface) itself, including turning background mode on or re-enabling
// a tool it accidentally switched off, without anyone touching Settings →
// MCP by hand. Same "ignore tool names you don't own" convention as the
// other bridges — see apiclient/mcpBridge.ts and mockserver/mcpBridge.ts.
//
// Answers, from anywhere the app can receive an `mcp:call` (which, per
// mcp_bridge.rs, means the app is open — this can't reach a fully closed
// app, only "open but not focused / tool not on screen"):
//   - devtool_mcp_status: current bridge/background/per-tool/mock-server state
//   - devtool_mcp_set_background: turn the background bridge on/off
//   - devtool_mcp_set_tool_enabled: turn one tool's MCP access on/off

import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/platform';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { useMcpToolEnabledMap, MCP_TOOL_IDS, type McpToolId } from '@/hooks/useMcpToolEnabled';
import { useMockServerRuntime } from '@/components/tools/mockserver/mcpRuntimeContext';

interface McpCallEvent {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface Deps {
  backgroundEnabled: boolean;
  setBackgroundEnabled: (v: boolean) => void;
  toolsEnabled: Record<McpToolId, boolean>;
  setToolEnabled: (id: McpToolId, v: boolean) => void;
  mockServer: { running: boolean; host: string; port: number };
}

function isMcpToolId(v: unknown): v is McpToolId {
  return typeof v === 'string' && (MCP_TOOL_IDS as string[]).includes(v);
}

function buildHandlers(deps: Deps): Record<string, ToolHandler> {
  return {
    devtool_mcp_status: async () => ({
      backgroundBridgeEnabled: deps.backgroundEnabled,
      toolsEnabled: deps.toolsEnabled,
      note: deps.backgroundEnabled
        ? 'API Client, Mock Server, Redis Client, and Kafka Explorer tools all answer MCP calls regardless of which tool is on screen — except any tool switched off in toolsEnabled, which never answers.'
        : 'Each tool only answers MCP calls while it is the one on screen (and only if enabled in toolsEnabled). Call devtool_mcp_set_background with enabled:true to lift the on-screen requirement.',
      mockServer: {
        running: deps.mockServer.running,
        url: deps.mockServer.running ? `http://${deps.mockServer.host}:${deps.mockServer.port}` : null,
      },
    }),

    devtool_mcp_set_background: async (args) => {
      if (typeof args.enabled !== 'boolean') {
        throw new Error('"enabled" is required and must be a boolean');
      }
      deps.setBackgroundEnabled(args.enabled);
      return { ok: true, backgroundBridgeEnabled: args.enabled };
    },

    devtool_mcp_set_tool_enabled: async (args) => {
      if (!isMcpToolId(args.tool)) {
        throw new Error(`"tool" must be one of ${MCP_TOOL_IDS.join(', ')}`);
      }
      if (typeof args.enabled !== 'boolean') {
        throw new Error('"enabled" is required and must be a boolean');
      }
      deps.setToolEnabled(args.tool, args.enabled);
      return { ok: true, tool: args.tool, enabled: args.enabled };
    },
  };
}

// Always listens (isTauri gate only, same as the other bridges) — no
// `enabled` prop, since there is only ever one mount point for this bridge
// and it must never depend on the very settings it exists to manage.
export function McpManageBridge(): null {
  const { enabled: backgroundEnabled, setEnabled: setBackgroundEnabled } = useMcpBackgroundBridge();
  const { isEnabled, setToolEnabled } = useMcpToolEnabledMap();
  const mockServer = useMockServerRuntime();

  const toolsEnabled = Object.fromEntries(MCP_TOOL_IDS.map((id) => [id, isEnabled(id)])) as Record<McpToolId, boolean>;

  const depsRef = useRef<Deps>({
    backgroundEnabled,
    setBackgroundEnabled,
    toolsEnabled,
    setToolEnabled,
    mockServer: { running: mockServer.status.running, host: mockServer.status.host, port: mockServer.status.port },
  });
  depsRef.current = {
    backgroundEnabled,
    setBackgroundEnabled,
    toolsEnabled,
    setToolEnabled,
    mockServer: { running: mockServer.status.running, host: mockServer.status.host, port: mockServer.status.port },
  };

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      const fn = await listen<McpCallEvent>('mcp:call', async (event) => {
        const { id, tool, args } = event.payload;
        const handler = buildHandlers(depsRef.current)[tool];
        // Not one of this bridge's tools — leave it for the API Client / Mock
        // Server / Redis / Kafka bridges, which may also be listening on the
        // same event.
        if (!handler) return;
        try {
          const result = await handler(args ?? {});
          await invoke('mcp_respond', { id, result: result ?? null, error: null });
        } catch (e) {
          await invoke('mcp_respond', { id, result: null, error: (e as Error).message ?? String(e) });
        }
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
