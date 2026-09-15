// MCP bridge — frontend half, Redis Client tool. Connection management only
// (list/add/update/delete/test/connect/disconnect) — no key/data operations,
// unlike the API Client and Mock Server bridges. Same shape as those: the
// Rust sidecar (src-tauri/src/bin/devtool-mcp-server.rs) forwards each tool
// call to the loopback control server (src-tauri/src/mcp_bridge.rs) as an
// `mcp:call` Tauri event; `useMcpBridge` answers it by running the matching
// handler below, then reports back via `mcp_respond`.
//
// Connection CRUD (list/add/update/delete/test) needs no React state at
// all — `redisApi` (createRedisApi in ./types.ts) is a thin wrapper over
// `sdk.service.call` to the Tier B sidecar (src-tauri/src/bin/devtool-svc-redis.rs),
// which reads/writes a JSON file in ITS OWN service-data dir, so it can be
// called directly from here regardless of whether RedisClient.tsx is
// mounted. Only connect/disconnect (which selects/connects a *saved*
// connection) touches persisted UI state (`connectedConnId`/`db`), which is
// why those go through the shared `RedisState` from mcpRuntimeContext.tsx
// instead of a second independent `usePersistentState` instance.
//
// Two mount points call this hook: `RedisClient.tsx` (while the tool is on
// screen — always works, no setting needed) and, when the user opts in via
// Settings → MCP, `McpBackgroundBridge.tsx` at the app root (works
// regardless of which tool is on screen). `enabled` lets a caller mount the
// hook without it actually registering a listener, so the two mount points
// don't both listen at once and double-answer the same call.

import { useEffect, useRef } from 'react';
import { usePluginSdkFor } from '@/platform';
import { isTauri } from '@/lib/platform';
import { useRedisApi } from './api';
import type { RedisApi, RedisConnection } from './types';
import type { RedisState } from './useRedisState';

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

async function requireConnection(redisApi: RedisApi, id: string): Promise<RedisConnection> {
  const all = await redisApi.listConfigs();
  const conn = all.find((c) => c.id === id);
  if (!conn) throw new Error(`No Redis connection with id "${id}"`);
  return conn;
}

function buildHandlers(redisApi: RedisApi, state: RedisState): Record<string, ToolHandler> {
  return {
    redis_list_connections: async () => redisApi.listConfigs(),

    redis_get_connection: async (args) => requireConnection(redisApi, requireString(args.connectionId, 'connectionId')),

    redis_add_connection: async (args) => {
      const conn: RedisConnection = {
        id: '',
        name: requireString(args.name, 'name'),
        host: typeof args.host === 'string' && args.host ? args.host : 'localhost',
        port: typeof args.port === 'number' ? args.port : 6379,
        username: typeof args.username === 'string' ? args.username : null,
        password: typeof args.password === 'string' ? args.password : null,
        useTls: typeof args.useTls === 'boolean' ? args.useTls : false,
      };
      return redisApi.saveConfig(conn);
    },

    // `patch` is a partial RedisConnection — only included fields change.
    // No nested objects on this type, so a plain shallow merge is correct
    // (unlike update_request's script/auth/body — see apiclient/mcpBridge.ts).
    redis_update_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const current = await requireConnection(redisApi, id);
      const patch = (args.patch ?? {}) as Partial<RedisConnection>;
      return redisApi.saveConfig({ ...current, ...patch, id });
    },

    redis_delete_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      await requireConnection(redisApi, id);
      await redisApi.deleteConfig(id);
      return { ok: true };
    },

    // Verifies reachability without changing the connected/selected state —
    // same as the UI's own "Connect" button before it marks the connection live.
    redis_test_connection: async (args) => {
      const conn = await requireConnection(redisApi, requireString(args.connectionId, 'connectionId'));
      await redisApi.testConnection(conn);
      return { ok: true };
    },

    // Tests reachability, then marks the connection live (mirrors
    // RedisClient.tsx's handleConnect) and optionally switches the active
    // logical db (0–15) in the same call.
    redis_connect: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const conn = await requireConnection(redisApi, id);
      await redisApi.testConnection(conn);
      state.setConnectedConnId(id);
      state.setSelectedConnId(id);
      if (typeof args.db === 'number') state.setDb(args.db);
      return { ok: true, connectedConnId: id, db: typeof args.db === 'number' ? args.db : state.db };
    },

    redis_disconnect: async () => {
      state.setConnectedConnId('');
      return { ok: true };
    },

    redis_connection_status: async () => ({
      selectedConnId: state.selectedConnId,
      connectedConnId: state.connectedConnId,
      db: state.db,
    }),
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* Redis state via a ref, matching this repo's convention for
// long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners") — same
// pattern as the API Client's/Mock Server's `useMcpBridge`.
export function useMcpBridge(state: RedisState, enabled = true): void {
  const sdk = usePluginSdkFor('redis-client');
  const redisApi = useRedisApi();
  const handlersRef = useRef<Record<string, ToolHandler>>({});
  handlersRef.current = buildHandlers(redisApi, state);

  useEffect(() => {
    if (!isTauri || !enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      // Qua SDK: sự kiện `mcp:call` và lệnh `mcp_respond` đều nằm trong quyền
      // 'native' + allowlist của plugin, nên cầu nối này cũng hiện trong nhật ký
      // như mọi lời gọi khác thay vì là một đường đi vòng.
      const fn = await sdk.native.listen<McpCallEvent>('mcp:call', async (payload) => {
        const { id, tool, args } = payload;
        const handler = handlersRef.current[tool];
        // Not one of this bridge's tools — leave it alone rather than
        // answering "unknown tool", since several bridges may be listening
        // on the shared mcp:call event at once (see McpBackgroundBridge.tsx).
        if (!handler) return;
        try {
          const result = await handler(args ?? {});
          await sdk.native.invoke('mcp_respond', { id, result: result ?? null, error: null });
        } catch (e) {
          await sdk.native.invoke('mcp_respond', { id, result: null, error: (e as Error).message ?? String(e) });
        }
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, sdk]);
}
