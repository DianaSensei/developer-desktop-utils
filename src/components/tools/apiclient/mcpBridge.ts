// MCP bridge — frontend half.
//
// The Rust side (src-tauri/src/mcp_bridge.rs) runs a small loopback HTTP
// server that an external MCP stdio sidecar (mcp-server/) talks to. Each MCP
// tool call it receives is handed to the webview as an `mcp:call` Tauri
// event; `useMcpBridge` (called once from ApiClient.tsx while it's mounted)
// answers it by running the matching handler below against the *live* API
// Client store, then reports the result back via the `mcp_respond` command —
// so an MCP tool call runs through the exact same store and request-sending
// engine (`runRequest`, from ApiClient.tsx) the user's own UI uses, and shows
// up in the UI/History like any other send.
//
// Deliberately excluded from this surface: the Vault (`store.vault`). It
// holds secrets the UI itself keeps out of generated code, cURL export, and
// history — an MCP client reading or editing it would defeat that boundary,
// so it stays UI-only.

import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/platform';
import type { ApiStore } from './store';
import type { ApiRequest, Environment, RequestScript, TreeItem } from './types';
import { newRequest } from './types';
import type { ExecResult } from './engine';

export type RunRequestFn = (
  req: ApiRequest,
  dataVars?: Record<string, string>,
  signal?: AbortSignal,
  envId?: string | null,
) => Promise<ExecResult>;

interface McpCallEvent {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function findRequestIn(items: TreeItem[], id: string): ApiRequest | null {
  for (const item of items) {
    if (item.id === id) return item.type === 'request' ? item : null;
    if (item.type === 'folder') {
      const found = findRequestIn(item.items, id);
      if (found) return found;
    }
  }
  return null;
}

function findRequestWithCollection(store: ApiStore, id: string): { request: ApiRequest; collectionId: string } {
  for (const c of store.collections) {
    const found = findRequestIn(c.items, id);
    if (found) return { request: found, collectionId: c.id };
  }
  throw new Error(`No request with id "${id}"`);
}

function requireCollection(store: ApiStore, id: string) {
  const c = store.collections.find((c) => c.id === id);
  if (!c) throw new Error(`No collection with id "${id}"`);
  return c;
}

function requireEnvironment(store: ApiStore, id: string) {
  const e = store.environments.find((e) => e.id === id);
  if (!e) throw new Error(`No environment with id "${id}"`);
  return e;
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
}

function summarizeItems(items: TreeItem[]): unknown[] {
  return items.map((item) =>
    item.type === 'folder'
      ? { id: item.id, type: 'folder', name: item.name, items: summarizeItems(item.items) }
      : { id: item.id, type: 'request', name: item.name, method: item.method, url: item.url },
  );
}

function buildHandlers(store: ApiStore, runRequest: RunRequestFn): Record<string, ToolHandler> {
  return {
    list_collections: async () =>
      store.collections.map((c) => ({ id: c.id, name: c.name, items: summarizeItems(c.items) })),

    get_collection: async (args) => requireCollection(store, requireString(args.collectionId, 'collectionId')),

    list_environments: async () =>
      store.environments.map((e) => ({ id: e.id, name: e.name, collectionId: e.collectionId ?? null })),

    get_environment: async (args) => requireEnvironment(store, requireString(args.environmentId, 'environmentId')),

    update_environment: async (args) => {
      const id = requireString(args.environmentId, 'environmentId');
      requireEnvironment(store, id);
      store.updateEnvironment(id, (args.patch ?? {}) as Partial<Environment>);
      return { ok: true };
    },

    set_active_environment: async (args) => {
      const envId = (args.environmentId ?? null) as string | null;
      if (args.scope === 'global') {
        store.setActiveGlobalEnv(envId);
      } else {
        const collectionId = requireString(args.collectionId, 'collectionId');
        requireCollection(store, collectionId);
        store.setActiveCollectionEnv(collectionId, envId);
      }
      return { ok: true };
    },

    get_request: async (args) => findRequestWithCollection(store, requireString(args.requestId, 'requestId')).request,

    update_request: async (args) => {
      const id = requireString(args.requestId, 'requestId');
      findRequestWithCollection(store, id);
      store.updateRequest(id, (args.patch ?? {}) as Partial<ApiRequest>);
      return findRequestWithCollection(store, id).request;
    },

    create_request: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      requireCollection(store, collectionId);
      const folderId = typeof args.folderId === 'string' ? args.folderId : undefined;
      const req = newRequest((args.request ?? {}) as Partial<ApiRequest>);
      store.addRequest(collectionId, req, folderId);
      return req;
    },

    delete_request: async (args) => {
      const id = requireString(args.requestId, 'requestId');
      const { collectionId } = findRequestWithCollection(store, id);
      store.deleteItem(collectionId, id);
      return { ok: true };
    },

    // Folder/collection-level script — a request's own pre/post-request
    // script is just a field on it (see update_request's `patch.script`).
    set_node_script: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      requireCollection(store, collectionId);
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : null;
      store.setNodeScript(collectionId, nodeId, (args.script ?? { req: '', res: '' }) as RequestScript);
      return { ok: true };
    },

    run_request: async (args) => {
      const id = requireString(args.requestId, 'requestId');
      const { request } = findRequestWithCollection(store, id);
      const envId = args.environmentId === undefined ? undefined : (args.environmentId as string | null);
      const result = await runRequest(request, {}, undefined, envId);
      return { response: result.response, tests: result.tests, logs: result.logs, error: result.error };
    },
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* store/runRequest via a ref, matching this repo's convention
// for long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners").
export function useMcpBridge(store: ApiStore, runRequest: RunRequestFn): void {
  const handlersRef = useRef<Record<string, ToolHandler>>({});
  handlersRef.current = buildHandlers(store, runRequest);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      const fn = await listen<McpCallEvent>('mcp:call', async (event) => {
        const { id, tool, args } = event.payload;
        try {
          const handler = handlersRef.current[tool];
          if (!handler) throw new Error(`Unknown MCP tool "${tool}"`);
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
