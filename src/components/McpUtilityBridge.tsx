// MCP bridge — stateless utility tools: Encode·Hash·Encrypt (`base64`), JWT
// Debugger (`jwt`), JSON Formatter (`json`). Unlike every connection-based
// bridge (API Client, Mock Server, Redis/Kafka/RabbitMQ/Container Clients),
// none of these three read or write any persisted app state — every
// operation is a pure function of its own arguments. That removes the
// entire reason the other bridges need an "on screen" vs "background"
// distinction: two listeners can never race over shared state that doesn't
// exist. So this bridge is mounted exactly once, unconditionally, at the
// app root (App.tsx) — it answers whether its tool is open, closed, or the
// app is showing something else entirely, with no Background MCP bridge
// toggle needed to reach that.
//
// The one thing that still gates it is the per-tool MCP kill switch
// (useMcpToolEnabledMap, Settings → MCP → Per-tool MCP access) — a tool
// switched off there stops answering here too, same as every other tool.
//
// Same "ignore tool names you don't own" convention as every other bridge
// — see apiclient/mcpBridge.ts. `buildCodecHandlers`/`buildJwtHandlers`/
// `buildJsonHandlers` are pure (no args beyond the call itself), so they're
// built once instead of behind a state ref like the stateful bridges.

import { useEffect } from 'react';
import { isTauri } from '@/lib/platform';
import { buildCodecHandlers } from './tools/codecMcpBridge';
import { buildJwtHandlers } from './tools/jwtMcpBridge';
import { buildJsonHandlers } from './tools/jsonMcpBridge';
import { useMcpToolEnabledMap } from '@/hooks/useMcpToolEnabled';

interface McpCallEvent {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const codecHandlers = buildCodecHandlers();
const jwtHandlers = buildJwtHandlers();
const jsonHandlers = buildJsonHandlers();

export function McpUtilityBridge(): null {
  const { isEnabled } = useMcpToolEnabledMap();
  const codecEnabled = isEnabled('base64');
  const jwtEnabled = isEnabled('jwt');
  const jsonEnabled = isEnabled('json');

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      const fn = await listen<McpCallEvent>('mcp:call', async (event) => {
        const { id, tool, args } = event.payload;
        const handlers: Record<string, ToolHandler> | null =
          tool.startsWith('codec_') || tool.startsWith('hash_') || tool === 'encrypt_text' || tool === 'decrypt_text'
            ? (codecEnabled ? codecHandlers : null)
            : tool.startsWith('jwt_')
              ? (jwtEnabled ? jwtHandlers : null)
              : tool.startsWith('json_')
                ? (jsonEnabled ? jsonHandlers : null)
                : null;
        const handler = handlers?.[tool];
        // Not one of this bridge's tools (or its tool is disabled) — leave
        // it alone rather than answering "unknown tool", since other
        // bridges may also be listening on the shared mcp:call event.
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
  }, [codecEnabled, jwtEnabled, jsonEnabled]);

  return null;
}
