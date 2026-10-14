// MCP bridge — frontend half.
//
// The Rust side (src-tauri/src/mcp_bridge.rs) runs a small loopback HTTP
// server that the MCP stdio sidecar
// (src-tauri/src/bin/devtool-mcp-server.rs) talks to. Each MCP tool call it
// receives is handed to the webview as an `mcp:call` Tauri
// event; `useMcpBridge` answers it by running the matching handler below
// against the *live* API Client store, then reports the result back via the
// `mcp_respond` command — so an MCP tool call runs through the exact same
// store and request-sending engine (`runRequest`) the user's own UI uses,
// and shows up in the UI/History like any other send.
//
// Two mount points call this hook: `ApiClient.tsx` (while the tool is on
// screen — always works, no setting needed) and, when the user opts in via
// Settings → MCP, `McpBackgroundBridge.tsx` at the app root (works
// regardless of which tool is on screen — see
// `useMcpBackgroundBridge`). `enabled` lets a caller mount the hook without
// it actually registering a listener, so the two mount points don't both
// listen at once and double-answer the same call.
//
// Deliberately excluded from this surface: the Vault (`store.vault`). It
// holds secrets the UI itself keeps out of generated code, cURL export, and
// history — an MCP client reading or editing it would defeat that boundary,
// so it stays UI-only.

import { useEffect, useRef } from 'react';
import { usePluginSdkFor } from '@/platform';
import { isTauri } from '@/lib/platform';
import { redactText, type ApiStore } from './store';
import type { ApiRequest, Auth, Environment, KeyValue, LogEntry, RequestBody, RequestScript, RequestSettings, TreeItem } from './types';
import { API_CLIENT_MCP_TOOLS } from './mcpTools';
import { newAuth, newEnvironment, newRequest, uid } from './types';
import { paramsFromUrl } from './request';
import type { ExecResult } from './engine';

export type RunRequestFn = (
  req: ApiRequest,
  dataVars?: Record<string, string>,
  signal?: AbortSignal,
  envId?: string | null,
  options?: { recordHistory?: boolean },
) => Promise<ExecResult & { sensitiveValues?: string[] }>;

/** Every string in a JSON-shaped value, with sensitive literals replaced. */
function redactStrings<T>(value: T, sensitiveValues: string[] = []): T {
  if (sensitiveValues.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redactText(v, sensitiveValues);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

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

// Same walk as findRequestIn, but for any tree node (folder or request) — used
// by the tools below that operate on either kind (rename/move/copy/delete).
function findItemIn(items: TreeItem[], id: string): TreeItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === 'folder') {
      const found = findItemIn(item.items, id);
      if (found) return found;
    }
  }
  return null;
}

function findItemWithCollection(store: ApiStore, id: string): { item: TreeItem; collectionId: string } {
  for (const c of store.collections) {
    const found = findItemIn(c.items, id);
    if (found) return { item: found, collectionId: c.id };
  }
  throw new Error(`No collection/folder/request item with id "${id}"`);
}

function requireCollection(store: ApiStore, id: string) {
  const c = store.collections.find((c) => c.id === id);
  if (!c) throw new Error(`No collection with id "${id}"`);
  return c;
}

// Resolves the collection root (nodeId=null) or a folder within it — the two
// kinds of node set_node_script/set_node_auth/set_node_headers can target —
// so their own current script/auth can be read for a partial-patch merge.
function requireNode(store: ApiStore, collectionId: string, nodeId: string | null): { script?: RequestScript; auth?: Auth } {
  const c = requireCollection(store, collectionId);
  if (!nodeId) return c;
  const item = findItemIn(c.items, nodeId);
  if (!item || item.type !== 'folder') throw new Error(`No folder with id "${nodeId}" in collection "${collectionId}"`);
  return item;
}

function requireFolder(store: ApiStore, collectionId: string, folderId: string) {
  const item = findItemIn(requireCollection(store, collectionId).items, folderId);
  if (!item || item.type !== 'folder') throw new Error(`No folder with id "${folderId}" in collection "${collectionId}"`);
  return item;
}

const WHERE = ['before', 'after', 'inside'] as const;
function requireWhere(v: unknown): (typeof WHERE)[number] {
  if (v === undefined) return 'inside';
  if (!WHERE.includes(v as (typeof WHERE)[number])) throw new Error(`"where" must be one of ${WHERE.join(', ')}`);
  return v as (typeof WHERE)[number];
}

/** A move/copy target: a collection or any item in one. */
function requireTarget(store: ApiStore, id: string) {
  if (store.collections.some((c) => c.id === id)) return;
  findItemWithCollection(store, id);
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

// update_request/set_node_script/set_node_auth accept a full object or a
// partial patch for these nested fields (script, auth, body, settings).
// The store merges only top-level fields, so these merge one level deeper:
// patching script.req keeps script.res. A full object still replaces.

function mergeScript(current: RequestScript | undefined, patch: unknown): RequestScript {
  const base = current ?? { req: '', res: '' };
  return { ...base, ...((patch ?? {}) as Partial<RequestScript>) };
}

function mergeAuth(current: Auth | undefined, patch: unknown): Auth {
  const base = current ?? newAuth();
  const p = (patch ?? {}) as Partial<Auth>;
  return {
    ...base,
    ...p,
    apiKey: { ...base.apiKey, ...(p.apiKey ?? {}) },
    oauth2: { ...base.oauth2, ...(p.oauth2 ?? {}) },
  };
}

function mergeBody(current: RequestBody, patch: unknown): RequestBody {
  const p = (patch ?? {}) as Partial<RequestBody>;
  return {
    ...current,
    ...p,
    ...(p.graphql ? { graphql: { ...(current.graphql ?? { query: '', variables: '' }), ...p.graphql } } : {}),
  };
}

function mergeSettings(current: RequestSettings, patch: unknown): RequestSettings {
  return { ...current, ...((patch ?? {}) as Partial<RequestSettings>) };
}

function summarizeItems(items: TreeItem[]): unknown[] {
  return items.map((item) =>
    item.type === 'folder'
      ? { id: item.id, type: 'folder', name: item.name, items: summarizeItems(item.items) }
      : { id: item.id, type: 'request', name: item.name, method: item.method, url: item.url },
  );
}

// Response bodies can be arbitrarily large (a multi-MB JSON dump, an image's
// base64) — returning them verbatim to an MCP client burns tokens (or blows
// past the model's context) for no benefit, since a human isn't reading raw
// base64 either way. Cap text bodies and drop bodyBase64 entirely in favor of
// a note, mirroring what get_request/get_collection already do by omitting
// bulk fields the caller didn't ask for.
const MAX_RESPONSE_BODY_CHARS = 20_000;

function summarizeResponseForMcp(response: ExecResult['response']): unknown {
  if (!response) return response;
  const { bodyBase64: _bodyBase64, body, ...rest } = response;
  const truncated = body.length > MAX_RESPONSE_BODY_CHARS;
  return {
    ...rest,
    body: truncated ? body.slice(0, MAX_RESPONSE_BODY_CHARS) : body,
    ...(truncated ? { bodyTruncated: true, bodyFullLength: body.length } : {}),
    ...(response.binary ? { bodyBase64Omitted: true } : {}),
  };
}

// A pre/post-request script's console.log output is just as unbounded as a
// response body (a loop over a large array, an accidental full-object dump) —
// cap entry count and each entry's own length the same way, rather than
// shipping whatever the script happened to log verbatim.
const MAX_LOG_ENTRIES = 200;
const MAX_LOG_ENTRY_CHARS = 2_000;

function summarizeLogsForMcp(logs: LogEntry[]): { logs: LogEntry[]; logsTruncated?: true; logsFullCount?: number } {
  const overflowed = logs.length > MAX_LOG_ENTRIES;
  const capped = (overflowed ? logs.slice(0, MAX_LOG_ENTRIES) : logs).map((l) =>
    l.text.length > MAX_LOG_ENTRY_CHARS ? { ...l, text: `${l.text.slice(0, MAX_LOG_ENTRY_CHARS)}… (truncated)` } : l,
  );
  return { logs: capped, ...(overflowed ? { logsTruncated: true, logsFullCount: logs.length } : {}) };
}

function buildHandlers(store: ApiStore, runRequest: RunRequestFn): Record<string, ToolHandler> {
  return {
    list_collections: async () =>
      store.collections.map((c) => ({ id: c.id, name: c.name, items: summarizeItems(c.items) })),

    // Returns collection-level fields (script/auth/variables/headers) plus a
    // summarized item tree (id/name/method/url) — not full nested request
    // bodies/scripts/tests, which would multiply token cost with the number
    // of requests in the collection. Use get_request for a specific one.
    get_collection: async (args) => {
      const c = requireCollection(store, requireString(args.collectionId, 'collectionId'));
      return { ...c, items: summarizeItems(c.items) };
    },

    list_environments: async () =>
      store.environments.map((e) => ({ id: e.id, name: e.name, collectionId: e.collectionId ?? null })),

    get_environment: async (args) => requireEnvironment(store, requireString(args.environmentId, 'environmentId')),

    // Whole-environment patch — `patch.variables` replaces the entire array,
    // same contract as set_collection_variables/set_node_headers. `patch` may
    // also include `collectionId` to move the environment between global
    // (null) and a collection's scope. For touching one or a few variables
    // without resending the rest, use set_environment_variable /
    // delete_environment_variable instead.
    update_environment: async (args) => {
      const id = requireString(args.environmentId, 'environmentId');
      requireEnvironment(store, id);
      store.updateEnvironment(id, (args.patch ?? {}) as Partial<Environment>);
      return { ok: true };
    },

    // Upsert one variable by key — creates it (enabled by default) if no
    // existing row has that key, otherwise patches only the fields passed.
    // Only replaces the one row; every other variable is left untouched.
    set_environment_variable: async (args) => {
      const id = requireString(args.environmentId, 'environmentId');
      const env = requireEnvironment(store, id);
      const key = requireString(args.key, 'key');
      const idx = env.variables.findIndex((v) => v.key === key);
      const variables = [...env.variables];
      if (idx >= 0) {
        variables[idx] = {
          ...variables[idx],
          ...(typeof args.value === 'string' ? { value: args.value } : {}),
          ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
          ...(typeof args.secret === 'boolean' ? { secret: args.secret } : {}),
        };
      } else {
        variables.push({
          id: uid(),
          key,
          value: typeof args.value === 'string' ? args.value : '',
          enabled: typeof args.enabled === 'boolean' ? args.enabled : true,
          ...(typeof args.secret === 'boolean' ? { secret: args.secret } : {}),
        });
      }
      store.updateEnvironment(id, { variables });
      return { ok: true, variable: variables[idx >= 0 ? idx : variables.length - 1] };
    },

    // Remove one variable by key. No-op (ok:true, deleted:false) if the key
    // wasn't present, rather than erroring.
    delete_environment_variable: async (args) => {
      const id = requireString(args.environmentId, 'environmentId');
      const env = requireEnvironment(store, id);
      const key = requireString(args.key, 'key');
      const variables = env.variables.filter((v) => v.key !== key);
      const deleted = variables.length !== env.variables.length;
      if (deleted) store.updateEnvironment(id, { variables });
      return { ok: true, deleted };
    },

    set_active_environment: async (args) => {
      const envId = (args.environmentId ?? null) as string | null;
      if (envId !== null) requireEnvironment(store, envId);
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

    // `patch.script`/`.auth`/`.body`/`.settings` may be a full object (same
    // as a plain replace) or a partial one — e.g. { script: { req: "..." } }
    // changes only the pre-request script and leaves the post-response one
    // (script.res) as-is, rather than clobbering it. See mergeScript/
    // mergeAuth/mergeBody/mergeSettings above.
    update_request: async (args) => {
      const id = requireString(args.requestId, 'requestId');
      const { request } = findRequestWithCollection(store, id);
      const patch = (args.patch ?? {}) as Partial<ApiRequest>;
      const merged: Partial<ApiRequest> = { ...patch };
      // The params table is what gets sent; the address bar keeps it in step
      // with the URL, so a URL patch has to as well.
      if (typeof patch.url === 'string' && !('params' in patch)) merged.params = paramsFromUrl(patch.url, request.params);
      if ('script' in patch) merged.script = mergeScript(request.script, patch.script);
      if ('auth' in patch) merged.auth = mergeAuth(request.auth, patch.auth);
      if ('body' in patch) merged.body = mergeBody(request.body, patch.body);
      if ('settings' in patch) merged.settings = mergeSettings(request.settings, patch.settings);
      store.updateRequest(id, merged);
      // `store` is this render's snapshot and does not have the update yet.
      return { ...request, ...merged };
    },

    create_request: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      requireCollection(store, collectionId);
      const folderId = typeof args.folderId === 'string' ? args.folderId : undefined;
      if (folderId) requireFolder(store, collectionId, folderId);
      const req = newRequest((args.request ?? {}) as Partial<ApiRequest>);
      store.addRequest(collectionId, req, folderId);
      return req;
    },

    run_request: async (args) => {
      const id = requireString(args.requestId, 'requestId');
      const { request } = findRequestWithCollection(store, id);
      const envId = args.environmentId === undefined ? undefined : (args.environmentId as string | null);
      // Recorded in History like a Send, as the tool description says.
      const { sensitiveValues, ...result } = await runRequest(request, {}, undefined, envId, { recordHistory: true });
      // Vault and secret-variable values never leave the app: the server can
      // echo them back (the final URL with an API key, a debug body), so the
      // result gets the same scrub as History.
      return redactStrings(
        {
          response: summarizeResponseForMcp(result.response),
          tests: result.tests,
          ...summarizeLogsForMcp(result.logs),
          error: result.error,
        },
        sensitiveValues,
      );
    },

    // ── folders & tree structure ────────────────────────────────────────

    add_folder: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      requireCollection(store, collectionId);
      const parentId = typeof args.parentId === 'string' ? args.parentId : undefined;
      if (parentId) requireFolder(store, collectionId, parentId);
      const id = store.addItem(collectionId, 'folder', parentId);
      if (typeof args.name === 'string' && args.name) store.renameItem(id, args.name);
      return { id };
    },

    rename_item: async (args) => {
      const id = requireString(args.itemId, 'itemId');
      findItemWithCollection(store, id); // throws if unknown
      store.renameItem(id, requireString(args.name, 'name'));
      return { ok: true };
    },

    // Deletes a request OR a folder (and everything inside it).
    delete_item: async (args) => {
      const id = requireString(args.itemId, 'itemId');
      const { collectionId } = findItemWithCollection(store, id);
      store.deleteItem(collectionId, id);
      return { ok: true };
    },

    clone_item: async (args) => {
      const id = requireString(args.itemId, 'itemId');
      const { collectionId } = findItemWithCollection(store, id);
      store.cloneItem(collectionId, id);
      return { ok: true };
    },

    // Move (cut) an item to a new spot. `targetId` may be a collection,
    // folder, or request/folder sibling; `where` says where relative to it.
    move_item: async (args) => {
      const sourceId = requireString(args.sourceId, 'sourceId');
      const targetId = requireString(args.targetId, 'targetId');
      const where = requireWhere(args.where);
      findItemWithCollection(store, sourceId);
      requireTarget(store, targetId);
      store.moveItem(sourceId, targetId, where);
      return { ok: true };
    },

    // Copy (not cut) an item to a new spot — same targeting as move_item.
    copy_item: async (args) => {
      const sourceId = requireString(args.sourceId, 'sourceId');
      const targetId = requireString(args.targetId, 'targetId');
      const where = requireWhere(args.where);
      findItemWithCollection(store, sourceId);
      requireTarget(store, targetId);
      store.copyItem(sourceId, targetId, where);
      return { ok: true };
    },

    // ── collections ──────────────────────────────────────────────────────

    add_collection: async (args) => {
      const id = store.addCollection();
      if (typeof args.name === 'string' && args.name) store.renameCollection(id, args.name);
      return { id };
    },

    rename_collection: async (args) => {
      const id = requireString(args.collectionId, 'collectionId');
      requireCollection(store, id);
      store.renameCollection(id, requireString(args.name, 'name'));
      return { ok: true };
    },

    delete_collection: async (args) => {
      const id = requireString(args.collectionId, 'collectionId');
      requireCollection(store, id);
      store.deleteCollection(id);
      return { ok: true };
    },

    clone_collection: async (args) => {
      const id = requireString(args.collectionId, 'collectionId');
      requireCollection(store, id);
      store.cloneCollection(id);
      return { ok: true };
    },

    set_collection_variables: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      requireCollection(store, collectionId);
      store.setCollectionVariables(collectionId, (args.variables ?? []) as KeyValue[]);
      return { ok: true };
    },

    // ── folder/collection-level script, auth, and headers — inherited by ──
    // ── every request under them. A request's OWN script/auth/headers are ──
    // ── just fields on it (see update_request's patch.script/.auth/.headers) ──

    // `script` may be a full { req, res } object or a partial one — merges
    // onto whatever this node's own script already is, same as
    // update_request's patch.script (see mergeScript above).
    set_node_script: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : null;
      const node = requireNode(store, collectionId, nodeId);
      store.setNodeScript(collectionId, nodeId, mergeScript(node.script, args.script));
      return { ok: true };
    },

    // `auth` may be a full Auth object or a partial one — merges onto
    // whatever this node's own auth already is, same as update_request's
    // patch.auth (see mergeAuth above).
    set_node_auth: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : null;
      const node = requireNode(store, collectionId, nodeId);
      store.setNodeAuth(collectionId, nodeId, mergeAuth(node.auth, args.auth));
      return { ok: true };
    },

    set_node_headers: async (args) => {
      const collectionId = requireString(args.collectionId, 'collectionId');
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : null;
      requireNode(store, collectionId, nodeId);
      store.setNodeHeaders(collectionId, nodeId, (args.headers ?? []) as KeyValue[]);
      return { ok: true };
    },

    // ── environments ─────────────────────────────────────────────────────

    add_environment: async (args) => {
      const collectionId = (typeof args.collectionId === 'string' ? args.collectionId : null);
      if (collectionId) requireCollection(store, collectionId);
      // One write: an add followed by updates in the same tick could undo
      // the add (it read the environments from this render).
      const name = typeof args.name === 'string' && args.name ? args.name : undefined;
      const variables = Array.isArray(args.variables) ? (args.variables as KeyValue[]) : [];
      if (name === undefined && variables.length === 0) return { id: store.addEnvironment(collectionId) };
      const id = store.importEnvironment(newEnvironment(name ?? 'New Environment', collectionId, variables));
      return { id };
    },

    duplicate_environment: async (args) => {
      const id = requireString(args.environmentId, 'environmentId');
      requireEnvironment(store, id);
      const newId = store.duplicateEnvironment(id);
      return { id: newId };
    },

    delete_environment: async (args) => {
      const id = requireString(args.environmentId, 'environmentId');
      requireEnvironment(store, id);
      store.deleteEnvironment(id);
      return { ok: true };
    },

    import_environment: async (args) => {
      const name = requireString(args.name, 'name');
      const collectionId = (typeof args.collectionId === 'string' ? args.collectionId : null);
      if (collectionId) requireCollection(store, collectionId);
      const env = newEnvironment(name, collectionId, (args.variables ?? []) as KeyValue[]);
      const id = store.importEnvironment(env);
      return { id };
    },
  };
}

// Registers the single `mcp:call` listener once and keeps it answering with
// the *latest* store/runRequest via a ref, matching this repo's convention
// for long-lived event listeners that read changing React state (see
// docs/ai/CLAUDE.md's "Stable refs for long-lived event listeners").
export function useMcpBridge(store: ApiStore, runRequest: RunRequestFn, enabled = true): void {
  const sdk = usePluginSdkFor('api-client');
  const handlersRef = useRef<Record<string, ToolHandler>>({});
  handlersRef.current = buildHandlers(store, runRequest);

  useEffect(() => {
    if (!isTauri || !enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      // Bundled with THIS tool, not the platform — devtool-mcp-server.rs has
      // no compiled-in tool list of its own (see that file), so registering
      // here is what makes its tools show up in `list_tools` at all. Same
      // 'native' + allowlist gate as `mcp_respond` below.
      await sdk.native.invoke('mcp_register_tools', { pluginId: sdk.id, tools: API_CLIENT_MCP_TOOLS });
      // Through the SDK: the `mcp:call` event and `mcp_respond` are covered
      // by the plugin's 'native' permission and allowlist, so they are audited.
      // One call at a time. Handlers read `store` as of the latest render
      // and merge onto it, so two calls in flight together (MCP clients do
      // call tools in parallel) would each write over the other. Waiting a
      // macrotask after each call lets React render its update first.
      let queue: Promise<void> = Promise.resolve();
      const fn = await sdk.native.listen<McpCallEvent>('mcp:call', (payload) => {
        const { id, tool, args } = payload;
        // Not one of this bridge's tools (e.g. a Mock Server tool while both
        // bridges are listening in the background) — leave it alone rather
        // than answering "unknown tool", since the two bridges share one
        // event and only one of them owns any given tool name.
        if (!handlersRef.current[tool]) return;
        queue = queue.then(async () => {
          const handler = handlersRef.current[tool];
          try {
            const result = await handler(args ?? {});
            await sdk.native.invoke('mcp_respond', { id, result: result ?? null, error: null });
          } catch (e) {
            await sdk.native.invoke('mcp_respond', { id, result: null, error: (e as Error).message ?? String(e) });
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // Best-effort — this tool's tools stop answering the moment
      // `mcp:call` is unlistened anyway; unregistering just keeps
      // `list_tools` honest about what will actually answer right now.
      sdk.native.invoke('mcp_unregister_tools', { pluginId: sdk.id }).catch(() => {});
    };
  }, [enabled, sdk]);
}
