// MCP bridge — frontend half, Mock Server tool.
//
// Same shape as the API Client's bridge (`../apiclient/mcpBridge.ts`): the Rust
// sidecar (`src-tauri/src/bin/devtool-mcp-server.rs`) forwards each tool call to
// the loopback control server (`src-tauri/src/mcp_bridge.rs`) as an `mcp:call`
// Tauri event; `useMcpBridge` (called once from `MockServer.tsx` while it's
// mounted) answers it by running the matching handler below against the
// *live* `useMockServer()` state, then reports back via `mcp_respond` — so an
// MCP tool call reuses the exact same stub-mutation functions and Tauri
// commands (`mock_start`/`mock_stop`/`mock_test_script`) the UI uses. Only one
// tool's bridge is ever mounted at a time (React Router unmounts the previous
// route), so this and the API Client's listener never collide on the same
// `mcp:call` event.
//
// A call only succeeds while the app is open AND the Mock Server tool is the
// one currently on screen — same contract as the API Client bridge, and for
// the same reason: `config`/`status` only exist as this mounted component's
// state.

import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/platform';
import type { MockServerState } from './useMockServer';
import type { MockConfig, RequestLogEntry, Stub } from './types';

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

function requireStub(config: MockConfig, id: string): Stub {
  const s = config.stubs.find((s) => s.id === id);
  if (!s) throw new Error(`No stub with id "${id}"`);
  return s;
}

// Not the full matchers/headers/body/script — just enough to see the routing
// table at a glance. Use mock_get_stub for one stub's full definition.
function summarizeStub(s: Stub) {
  return { id: s.id, enabled: s.enabled, name: s.name, method: s.method, path: s.path, mode: s.mode, status: s.status };
}

// Request/response bodies logged from real traffic can be arbitrarily large
// (a big JSON dump, an uploaded file) — cap them the same way the API
// Client's run_request caps a response body (see that file's
// summarizeResponseForMcp), so a chatty stub's log doesn't blow up context.
const MAX_LOG_BODY_CHARS = 5_000;

function truncateBody(text: string): { text: string; truncated: boolean; fullLength: number } {
  if (text.length <= MAX_LOG_BODY_CHARS) return { text, truncated: false, fullLength: text.length };
  return { text: text.slice(0, MAX_LOG_BODY_CHARS), truncated: true, fullLength: text.length };
}

function summarizeLogEntry(e: RequestLogEntry): unknown {
  const req = truncateBody(e.reqBody);
  const res = truncateBody(e.resBody);
  return {
    id: e.id, ts: e.ts, method: e.method, path: e.path, query: e.query, status: e.status,
    matchedStubId: e.matchedStubId, durationMs: e.durationMs, reqHeaders: e.reqHeaders,
    reqBody: req.text,
    ...(req.truncated ? { reqBodyTruncated: true, reqBodyFullLength: req.fullLength } : {}),
    resBody: res.text,
    ...(res.truncated ? { resBodyTruncated: true, resBodyFullLength: res.fullLength } : {}),
  };
}

function buildHandlers(state: MockServerState): Record<string, ToolHandler> {
  return {
    mock_get_config: async () => ({
      host: state.config.host,
      port: state.config.port,
      notFoundStatus: state.config.notFoundStatus,
      notFoundBody: state.config.notFoundBody,
      notFoundContentType: state.config.notFoundContentType,
      running: state.status.running,
      url: state.status.running ? `http://${state.status.host}:${state.status.port}` : null,
      stubs: state.config.stubs.map(summarizeStub),
    }),

    mock_get_stub: async (args) => requireStub(state.config, requireString(args.stubId, 'stubId')),

    mock_add_stub: async (args) => state.addStub((args.stub ?? {}) as Partial<Stub>),

    mock_update_stub: async (args) => {
      const id = requireString(args.stubId, 'stubId');
      requireStub(state.config, id);
      state.updateStub(id, (args.patch ?? {}) as Partial<Stub>);
      return { ok: true };
    },

    mock_duplicate_stub: async (args) => {
      const id = requireString(args.stubId, 'stubId');
      requireStub(state.config, id);
      const copy = state.duplicateStub(id);
      if (!copy) throw new Error(`No stub with id "${id}"`);
      return copy;
    },

    mock_delete_stub: async (args) => {
      const id = requireString(args.stubId, 'stubId');
      requireStub(state.config, id);
      state.deleteStub(id);
      return { ok: true };
    },

    // direction is relative order, not an absolute index — first match wins,
    // so this is how a caller reprioritizes overlapping stubs.
    mock_move_stub: async (args) => {
      const id = requireString(args.stubId, 'stubId');
      requireStub(state.config, id);
      const direction = args.direction;
      if (direction !== 'up' && direction !== 'down') throw new Error('"direction" must be "up" or "down"');
      state.moveStub(id, direction === 'up' ? -1 : 1);
      return { ok: true };
    },

    // The "no stub matched" response — notFoundStatus/notFoundBody/notFoundContentType.
    mock_set_fallback: async (args) => {
      state.updateConfig((args.patch ?? {}) as Partial<MockConfig>);
      return { ok: true };
    },

    // Bind address for the next Start — changing it while running does NOT
    // hot-swap the live listener (only stubs/fallback do); call mock_stop then
    // mock_start to rebind.
    mock_set_bind: async (args) => {
      const patch: Partial<MockConfig> = {};
      if (typeof args.host === 'string') patch.host = args.host;
      if (typeof args.port === 'number') patch.port = args.port;
      state.updateConfig(patch);
      return { ok: true };
    },

    mock_start: async () => state.start(),
    mock_stop: async () => { await state.stop(); return { ok: true }; },
    mock_status: async () => state.status,

    // Runs a Rhai response script against a synthetic request without saving
    // it to a stub first — useful for iterating on a script before committing it.
    mock_test_script: async (args) => {
      const script = requireString(args.script, 'script');
      const sample = (args.sample ?? { method: 'GET', path: '/', query: {}, headers: {}, params: {}, body: '' }) as Record<string, unknown>;
      return state.testScript(script, sample);
    },

    mock_get_request_log: async (args) => {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
      return state.log.slice(0, limit).map(summarizeLogEntry);
    },

    mock_clear_request_log: async () => {
      state.clearLog();
      return { ok: true };
    },
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* mock server state via a ref, matching this repo's convention
// for long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners") — same
// pattern as the API Client's `useMcpBridge`.
export function useMcpBridge(state: MockServerState): void {
  const handlersRef = useRef<Record<string, ToolHandler>>({});
  handlersRef.current = buildHandlers(state);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      const fn = await listen<McpCallEvent>('mcp:call', async (event) => {
        const { id, tool, args } = event.payload;
        const handler = handlersRef.current[tool];
        // Not one of this bridge's tools (e.g. an API Client tool) — leave it
        // alone rather than answering "unknown tool", since the two bridges
        // share one event and only one of them owns any given tool name.
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
}
