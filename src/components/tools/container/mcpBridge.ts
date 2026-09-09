// MCP bridge — frontend half, Containers tool. Unlike the redis_*/kafka_*/
// rabbit_* bridges (connection management only), this one covers full
// container lifecycle management too, plus image list/remove — the user
// explicitly asked for that wider scope. It's still the narrowest useful
// slice of `containerApi`: no volumes/networks, no image pull/tag/prune, no
// live-streaming logs/stats (both collected as bounded one-shot snapshots
// instead — see container_logs/container_stats below), no cgroup resource
// edits. Same shape as every other tool bridge: the Rust sidecar
// (src-tauri/src/bin/devtool-mcp-server.rs) forwards each tool call to the
// loopback control server (src-tauri/src/mcp_bridge.rs) as an `mcp:call`
// Tauri event; `useMcpBridge` answers it by running the matching handler
// below, then reports back via `mcp_respond`.
//
// Connection CRUD (list/add/update/delete) needs no React state at all —
// `containerApi` is a thin wrapper over Tauri commands that read/write a
// JSON file in the app data dir (src-tauri/src/container_tool.rs), so it
// can be called directly regardless of whether ContainerManager.tsx is
// mounted. Every lifecycle/image operation below needs an ACTIVE
// connection (`state.connectedConnId`) — there is no per-call connection
// argument on `containerApi.list`/`start`/`stop`/etc., only a full
// `ContainerConnection` object, so these operate on whichever connection
// the tool (or a prior `container_connect` MCP call) has marked live,
// mirroring how `mock_*` tools operate on "the" mock server rather than
// taking a server id per call.

import { useEffect, useRef } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/platform';
import { containerApi, type ContainerConnection, type LogLine, type StatsFrame } from './types';
import type { ContainerToolState } from './useContainerState';

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

async function requireConnection(id: string): Promise<ContainerConnection> {
  const all = await containerApi.listConfigs();
  const conn = all.find((c) => c.id === id);
  if (!conn) throw new Error(`No container connection with id "${id}"`);
  return conn;
}

async function requireActiveConnection(state: ContainerToolState): Promise<ContainerConnection> {
  if (!state.connectedConnId) {
    throw new Error('No active container connection — call container_connect with a connectionId first.');
  }
  return requireConnection(state.connectedConnId);
}

// Log/stats streams are inherently long-lived (a Tauri Channel), which
// doesn't fit MCP's one request/one response shape. Collect what arrives
// within a short window instead of an open-ended live tail — long enough to
// catch the requested tail on an idle container, short enough that a call
// doesn't hang.
const COLLECT_WINDOW_MS = 1500;

function collectLogs(
  config: ContainerConnection, containerId: string, tail: string,
  since: number, until: number, timestamps: boolean,
): Promise<LogLine[]> {
  return new Promise((resolve) => {
    const lines: LogLine[] = [];
    const channel = new Channel<LogLine>();
    channel.onmessage = (line) => lines.push(line);
    let streamId: string | null = null;
    containerApi.logsStart(config, containerId, tail, since, until, timestamps, channel)
      .then((id) => { streamId = id; })
      .catch(() => { /* surfaced as an empty result — the container may not exist */ });
    setTimeout(() => {
      if (streamId) void containerApi.logsStop(streamId);
      resolve(lines);
    }, COLLECT_WINDOW_MS);
  });
}

function buildHandlers(state: ContainerToolState): Record<string, ToolHandler> {
  return {
    // ── Connections ──────────────────────────────────────────────────────
    container_list_connections: async () => containerApi.listConfigs(),

    container_get_connection: async (args) => requireConnection(requireString(args.connectionId, 'connectionId')),

    container_add_connection: async (args) => {
      const conn: ContainerConnection = {
        id: '',
        name: requireString(args.name, 'name'),
        socketPath: requireString(args.socketPath, 'socketPath'),
      };
      return containerApi.saveConfig(conn);
    },

    // `patch` is a partial ContainerConnection — only included fields
    // change. No nested objects on this type, so a plain shallow merge is
    // correct (unlike update_request's script/auth/body — see
    // apiclient/mcpBridge.ts).
    container_update_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const current = await requireConnection(id);
      const patch = (args.patch ?? {}) as Partial<ContainerConnection>;
      return containerApi.saveConfig({ ...current, ...patch, id });
    },

    container_delete_connection: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      await requireConnection(id);
      await containerApi.deleteConfig(id);
      return { ok: true };
    },

    container_test_connection: async (args) => {
      const conn = await requireConnection(requireString(args.connectionId, 'connectionId'));
      await containerApi.testConnection(conn);
      return { ok: true };
    },

    container_connect: async (args) => {
      const id = requireString(args.connectionId, 'connectionId');
      const conn = await requireConnection(id);
      await containerApi.testConnection(conn);
      state.setConnectedConnId(id);
      state.setSelectedConnId(id);
      return { ok: true, connectedConnId: id };
    },

    container_disconnect: async () => {
      state.setConnectedConnId('');
      return { ok: true };
    },

    container_connection_status: async () => ({
      selectedConnId: state.selectedConnId,
      connectedConnId: state.connectedConnId,
    }),

    // ── Container lifecycle (operate on the active connection) ─────────────
    container_list: async (args) => {
      const config = await requireActiveConnection(state);
      return containerApi.list(config, args.all === true);
    },

    container_inspect: async (args) => {
      const config = await requireActiveConnection(state);
      return containerApi.details(config, requireString(args.containerId, 'containerId'));
    },

    container_start: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.start(config, requireString(args.containerId, 'containerId'));
      return { ok: true };
    },

    container_stop: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.stop(config, requireString(args.containerId, 'containerId'));
      return { ok: true };
    },

    container_restart: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.restart(config, requireString(args.containerId, 'containerId'));
      return { ok: true };
    },

    container_pause: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.pause(config, requireString(args.containerId, 'containerId'));
      return { ok: true };
    },

    container_unpause: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.unpause(config, requireString(args.containerId, 'containerId'));
      return { ok: true };
    },

    container_remove: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.remove(config, requireString(args.containerId, 'containerId'), args.force === true);
      return { ok: true };
    },

    // Collects up to ~1.5s of recent output rather than opening a live tail
    // — see collectLogs above. `tail` matches the daemon's own flag (a
    // count, or "all"); defaults to the last 100 lines.
    container_logs: async (args) => {
      const config = await requireActiveConnection(state);
      const containerId = requireString(args.containerId, 'containerId');
      const tail = typeof args.tail === 'string' ? args.tail : typeof args.tail === 'number' ? String(args.tail) : '100';
      const since = typeof args.since === 'number' ? args.since : 0;
      const until = typeof args.until === 'number' ? args.until : 0;
      const timestamps = args.timestamps === true;
      const lines = await collectLogs(config, containerId, tail, since, until, timestamps);
      return { lines };
    },

    // One CPU/memory/network sample, not a live stream — same data
    // `statsSnapshot` feeds the container table's live usage columns with.
    container_stats: async (args) => {
      const config = await requireActiveConnection(state);
      const containerId = requireString(args.containerId, 'containerId');
      const snapshot = await containerApi.statsSnapshot(config, [containerId]);
      const stats: StatsFrame | undefined = snapshot[containerId];
      if (!stats) throw new Error(`No stats available for container "${containerId}" (is it running?)`);
      return stats;
    },

    // ── Images (operate on the active connection) ───────────────────────
    container_list_images: async () => {
      const config = await requireActiveConnection(state);
      return containerApi.imageList(config);
    },

    container_image_details: async (args) => {
      const config = await requireActiveConnection(state);
      return containerApi.imageDetails(config, requireString(args.imageId, 'imageId'));
    },

    container_remove_image: async (args) => {
      const config = await requireActiveConnection(state);
      await containerApi.imageRemove(config, requireString(args.imageId, 'imageId'), args.force === true);
      return { ok: true };
    },
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* Container state via a ref, matching this repo's convention
// for long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners") — same
// pattern as the API Client's/Mock Server's/Redis's/Kafka's/RabbitMQ's
// `useMcpBridge`.
export function useMcpBridge(state: ContainerToolState, enabled = true): void {
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
