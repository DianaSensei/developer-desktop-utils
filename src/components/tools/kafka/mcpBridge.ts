// MCP bridge — frontend half, Kafka Explorer tool. Connection management
// only (list/add/update/delete/test/connect/disconnect) — no topic/consumer
// group/produce/consume operations, unlike the API Client and Mock Server
// bridges. Same shape as those: the Rust sidecar
// (src-tauri/src/bin/devtool-mcp-server.rs) forwards each tool call to the
// loopback control server (src-tauri/src/mcp_bridge.rs) as an `mcp:call`
// Tauri event; `useMcpBridge` answers it by running the matching handler
// below, then reports back via `mcp_respond`.
//
// Connection CRUD (list/add/update/delete/test) needs no React state at
// all — `kafkaApi` is a thin wrapper over Tauri commands that read/write a
// JSON file in the app data dir (src-tauri/src/kafka.rs), so it can be
// called directly from here regardless of whether KafkaExplorer.tsx is
// mounted. Only connect/disconnect (which selects/connects a *saved*
// broker) touches persisted UI state (`connectedBrokerId`), which is why
// those go through the shared `KafkaState` from mcpRuntimeContext.tsx
// instead of a second independent `usePersistentState` instance.
//
// Two mount points call this hook: `KafkaExplorer.tsx` (while the tool is
// on screen — always works, no setting needed) and, when the user opts in
// via Settings → MCP, `McpBackgroundBridge.tsx` at the app root (works
// regardless of which tool is on screen). `enabled` lets a caller mount the
// hook without it actually registering a listener, so the two mount points
// don't both listen at once and double-answer the same call.

import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/platform';
import { kafkaApi, type BrokerConfig } from './types';
import { kafkaConsumerStore } from './kafkaConsumerStore';
import type { KafkaState } from './useKafkaState';

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

async function requireConnection(id: string): Promise<BrokerConfig> {
  const all = await kafkaApi.listConfigs();
  const conn = all.find((c) => c.id === id);
  if (!conn) throw new Error(`No Kafka connection with id "${id}"`);
  return conn;
}

function buildHandlers(state: KafkaState): Record<string, ToolHandler> {
  return {
    kafka_list_connections: async () => kafkaApi.listConfigs(),

    kafka_get_connection: async (args) => requireConnection(requireString(args.connectionId, 'connectionId')),

    kafka_add_connection: async (args) => {
      const conn: BrokerConfig = {
        id: '',
        name: requireString(args.name, 'name'),
        bootstrapServers: requireString(args.bootstrapServers, 'bootstrapServers'),
        saslMechanism: typeof args.saslMechanism === 'string' ? args.saslMechanism : undefined,
        saslUsername: typeof args.saslUsername === 'string' ? args.saslUsername : undefined,
        saslPassword: typeof args.saslPassword === 'string' ? args.saslPassword : undefined,
        sslEnabled: typeof args.sslEnabled === 'boolean' ? args.sslEnabled : false,
      };
      return kafkaApi.saveConfig(conn);
    },

    // `patch` is a partial BrokerConfig — only included fields change. No
    // nested objects on this type, so a plain shallow merge is correct
    // (unlike update_request's script/auth/body — see apiclient/mcpBridge.ts).
    kafka_update_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const current = await requireConnection(id);
      const patch = (args.patch ?? {}) as Partial<BrokerConfig>;
      return kafkaApi.saveConfig({ ...current, ...patch, id });
    },

    kafka_delete_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      await requireConnection(id);
      await kafkaApi.deleteConfig(id);
      return { ok: true };
    },

    // Verifies reachability without changing the connected/selected state —
    // same as the UI's own "Connect" button before it marks the broker live.
    kafka_test_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      await requireConnection(id);
      await kafkaApi.testConnection(id);
      return { ok: true };
    },

    // Tests reachability, then marks the broker live (mirrors
    // KafkaExplorer.tsx's handleConnect) — stopping any realtime consumers
    // still running against a previously-connected broker, since only one
    // broker is live at a time.
    kafka_connect: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      await requireConnection(id);
      await kafkaApi.testConnection(id);
      if (state.connectedBrokerId && state.connectedBrokerId !== id) {
        kafkaConsumerStore.stopForBroker(state.connectedBrokerId);
      }
      state.setConnectedBrokerId(id);
      state.setSelectedBrokerId(id);
      return { ok: true, connectedBrokerId: id };
    },

    kafka_disconnect: async () => {
      if (state.connectedBrokerId) kafkaConsumerStore.stopForBroker(state.connectedBrokerId);
      state.setConnectedBrokerId('');
      return { ok: true };
    },

    kafka_connection_status: async () => ({
      selectedBrokerId: state.selectedBrokerId,
      connectedBrokerId: state.connectedBrokerId,
    }),
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* Kafka state via a ref, matching this repo's convention for
// long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners") — same
// pattern as the API Client's/Mock Server's/Redis's `useMcpBridge`.
export function useMcpBridge(state: KafkaState, enabled = true): void {
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
