// MCP bridge — frontend half, RabbitMQ Client tool. Connection management
// only (list/add/update/delete/test/connect/disconnect) — no queue/exchange/
// publish/consume/RPC operations, unlike the API Client and Mock Server
// bridges. Same shape as those (and as redis/mcpBridge.ts, kafka/mcpBridge.ts):
// the Rust sidecar (src-tauri/src/bin/devtool-mcp-server.rs) forwards each
// tool call to the loopback control server (src-tauri/src/mcp_bridge.rs) as
// an `mcp:call` Tauri event; `useMcpBridge` answers it by running the
// matching handler below, then reports back via `mcp_respond`.
//
// Connection CRUD (list/add/update/delete) needs no React state at all —
// `rabbitApi` is a thin wrapper over Tauri commands that read/write a JSON
// file in the app data dir (src-tauri/src/rabbit.rs), so it can be called
// directly from here regardless of whether RabbitClient.tsx is mounted.
// Test/connect additionally call `rabbitMgmt.testConnection` (a plain HTTP
// request to the broker's management API) when the profile isn't
// AMQP-only — same two-step check as RabbitClient.tsx's own handleConnect.
// Only connect/disconnect touches persisted UI state (`connectedConnId`),
// which is why those go through the shared `RabbitState` from
// mcpRuntimeContext.tsx instead of a second independent `usePersistentState`
// instance.
//
// Two mount points call this hook: `RabbitClient.tsx` (while the tool is on
// screen — always works, no setting needed) and, when the user opts in via
// Settings → MCP, `McpBackgroundBridge.tsx` at the app root (works
// regardless of which tool is on screen). `enabled` lets a caller mount the
// hook without it actually registering a listener, so the two mount points
// don't both listen at once and double-answer the same call.

import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/platform';
import { rabbitApi, type RabbitConnection } from './types';
import { rabbitMgmt } from './api';
import { consumerStore } from './consumerStore';
import type { RabbitState } from './useRabbitState';

interface McpCallEvent {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
}

async function requireConnection(id: string): Promise<RabbitConnection> {
  const all = await rabbitApi.listConfigs();
  const conn = all.find((c) => c.id === id);
  if (!conn) throw new Error(`No RabbitMQ connection with id "${id}"`);
  return conn;
}

// Same two-step check RabbitClient.tsx's handleConnect runs: AMQP is always
// tested; the management API is only tested when the profile isn't
// AMQP-only (an AMQP-only broker may not expose it at all).
async function testConnection(conn: RabbitConnection): Promise<void> {
  await rabbitApi.amqpTest(conn);
  if (!conn.amqpOnly) await rabbitMgmt.testConnection(conn);
}

function buildHandlers(state: RabbitState): Record<string, ToolHandler> {
  return {
    rabbit_list_connections: async () => rabbitApi.listConfigs(),

    rabbit_get_connection: async (args) => requireConnection(requireString(args.connectionId, 'connectionId')),

    rabbit_add_connection: async (args) => {
      const conn: RabbitConnection = {
        id: '',
        name: requireString(args.name, 'name'),
        host: typeof args.host === 'string' && args.host ? args.host : 'localhost',
        port: typeof args.port === 'number' ? args.port : 15672,
        vhost: typeof args.vhost === 'string' && args.vhost ? args.vhost : '/',
        username: typeof args.username === 'string' ? args.username : 'guest',
        password: typeof args.password === 'string' ? args.password : 'guest',
        useTls: typeof args.useTls === 'boolean' ? args.useTls : false,
        amqpPort: typeof args.amqpPort === 'number' ? args.amqpPort : 5672,
        amqpOnly: typeof args.amqpOnly === 'boolean' ? args.amqpOnly : true,
      };
      return rabbitApi.saveConfig(conn);
    },

    // `patch` is a partial RabbitConnection — only included fields change.
    // No nested objects on this type, so a plain shallow merge is correct
    // (unlike update_request's script/auth/body — see apiclient/mcpBridge.ts).
    rabbit_update_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const current = await requireConnection(id);
      const patch = (args.patch ?? {}) as Partial<RabbitConnection>;
      return rabbitApi.saveConfig({ ...current, ...patch, id });
    },

    rabbit_delete_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      await requireConnection(id);
      await rabbitApi.deleteConfig(id);
      return { ok: true };
    },

    // Verifies reachability without changing the connected/selected state —
    // same as the UI's own "Connect" button before it marks the connection live.
    rabbit_test_connection: async (args) => {
      const conn = await requireConnection(requireString(args.connectionId, 'connectionId'));
      await testConnection(conn);
      return { ok: true };
    },

    // Tests reachability, then marks the connection live (mirrors
    // RabbitClient.tsx's handleConnect) — stopping any live consumers still
    // running against a previously-connected connection, since only one
    // connection is live at a time.
    rabbit_connect: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const conn = await requireConnection(id);
      await testConnection(conn);
      if (state.connectedConnId && state.connectedConnId !== id) {
        consumerStore.stopForConn(state.connectedConnId);
      }
      state.setConnectedConnId(id);
      state.setSelectedConnId(id);
      return { ok: true, connectedConnId: id };
    },

    rabbit_disconnect: async () => {
      if (state.connectedConnId) consumerStore.stopForConn(state.connectedConnId);
      state.setConnectedConnId('');
      return { ok: true };
    },

    rabbit_connection_status: async () => ({
      selectedConnId: state.selectedConnId,
      connectedConnId: state.connectedConnId,
    }),
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* Rabbit state via a ref, matching this repo's convention for
// long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners") — same
// pattern as the API Client's/Mock Server's/Redis's/Kafka's `useMcpBridge`.
export function useMcpBridge(state: RabbitState, enabled = true): void {
  const handlersRef = useRef<Record<string, ToolHandler>>({});
  handlersRef.current = buildHandlers(state);

  useEffect(() => {
    if (!isTauri || !enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      const fn = await listen<McpCallEvent>('mcp:call', async (event) => {
        const { id, tool, args } = event.payload;
        const handler = handlersRef.current[tool];
        // Not one of this bridge's tools — leave it alone rather than
        // answering "unknown tool", since several bridges may be listening
        // on the shared mcp:call event at once (see McpBackgroundBridge.tsx).
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
  }, [enabled]);
}
