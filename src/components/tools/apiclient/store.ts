// Persistent state for the API Client.
//
// Everything (collections, environments, history) is JSON-serializable and kept
// in localStorage via usePersistentState, so the workspace survives app
// restarts — consistent with the rest of DevTool. Tree edits are applied
// immutably through small recursive helpers.

import { useCallback, useMemo } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { storageGet } from '@/lib/persistentStore';
import { type Cookie, applySetCookies } from './cookies';
import { paramsFromUrl } from './request';
import {
  type ApiRequest,
  type Auth,
  type Collection,
  type Environment,
  type Folder,
  type HistoryEntry,
  type KeyValue,
  type RequestScript,
  type TreeItem,
  type VarMap,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  normalizeRequest,
  uid,
} from './types';

const MAX_HISTORY = 50;
const MAX_HISTORY_BODY = 256 * 1024; // cap stored response bodies at 256 KB
const REDACTED_PLACEHOLDER = '••••••••';
// Values shorter than this are too likely to collide with ordinary response
// text (e.g. a one-character vault entry) to redact safely.
const MIN_REDACTABLE_LENGTH = 4;

// Best-effort scrub of literal secret values from response text. The request
// snapshot in a HistoryEntry is always the pre-substitution original (still
// holding literal `{{...}}` tokens, never the resolved secret), but the
// response is the real one the server sent back — if a vault/secret-flagged
// value happens to be echoed by the server (a redirect Location, a debug
// endpoint, an error message), it would otherwise sit in plaintext History
// across restarts. This can only catch exact, unencoded matches — a
// transformed/encoded echo won't be caught — so it's a mitigation, not a
// guarantee.
function redactText(text: string, sensitiveValues: string[]): string {
  let out = text;
  for (const v of sensitiveValues) {
    if (v.length >= MIN_REDACTABLE_LENGTH) out = out.split(v).join(REDACTED_PLACEHOLDER);
  }
  return out;
}

// Keep history entries lean in localStorage: truncate huge response bodies and
// drop binary file payloads from the request snapshot (filenames are kept).
// `sensitiveValues` are the literal vault/secret values in scope for this send
// (see redactText above) — pass [] to skip redaction entirely.
function trimHistoryEntry(
  entry: Omit<HistoryEntry, 'id' | 'at'>,
  sensitiveValues: string[] = [],
): Omit<HistoryEntry, 'id' | 'at'> {
  const out = { ...entry };
  if (out.response) {
    const r = out.response;
    // `bodyBase64` holds the raw bytes of a binary response (up to 16 MB). It is
    // useful in the live viewer but must never reach storage — fifty of those
    // would blow the whole workspace past the storage quota.
    const needsTrim = r.body.length > MAX_HISTORY_BODY || r.bodyBase64 !== undefined;
    const needsRedact = sensitiveValues.length > 0;
    if (needsTrim || needsRedact) {
      const body = r.body.length > MAX_HISTORY_BODY ? r.body.slice(0, MAX_HISTORY_BODY) : r.body;
      out.response = {
        ...r,
        body: needsRedact ? redactText(body, sensitiveValues) : body,
        bodyBase64: undefined,
        headers: needsRedact
          ? r.headers.map(([k, v]) => [k, redactText(v, sensitiveValues)] as [string, string])
          : r.headers,
        url: needsRedact && r.url ? redactText(r.url, sensitiveValues) : r.url,
      };
    }
  }
  if (out.request) {
    const r = out.request;
    out.request = {
      ...r,
      body: {
        ...r.body,
        fileContent: undefined,
        form: r.body.form.map((f) => (f.fileContent ? { ...f, fileContent: undefined } : f)),
      },
    };
  }
  // The three text channels a secret reaches besides the response itself.
  // Redaction covered the body, headers and final URL but stopped there, so a
  // value scrubbed out of the response was still written to disk alongside it:
  //
  //   error  — reqwest names the URL it failed on, and an API key placed as a
  //            query param is resolved into that URL before it is sent.
  //   logs   — `console.log(bru.getEnvVar('token'))` while debugging a script
  //            is ordinary, and every line is persisted.
  //   tests  — an assertion failure quotes the values it compared.
  //
  // The request snapshot deliberately isn't touched: it holds the request as
  // authored, so secrets appear there as `{{vault.token}}`, never resolved.
  if (sensitiveValues.length > 0) {
    if (out.error) out.error = redactText(out.error, sensitiveValues);
    if (out.logs?.length) {
      out.logs = out.logs.map((l) => ({ ...l, text: redactText(l.text, sensitiveValues) }));
    }
    if (out.tests?.length) {
      out.tests = out.tests.map((t) => ({
        ...t,
        name: redactText(t.name, sensitiveValues),
        ...(t.error ? { error: redactText(t.error, sensitiveValues) } : {}),
      }));
    }
  }
  return out;
}

// First-run sample so the tool isn't an empty screen.
function seedCollections(): Collection[] {
  const sample = newRequest({
    name: 'Get IP',
    method: 'GET',
    url: 'https://httpbin.org/get',
  });
  return [{ id: uid(), name: 'My Collection', items: [sample] }];
}

// ─── immutable tree helpers ─────────────────────────────────────────────────

// Identity-preserving map: returns the SAME array/objects when nothing changed,
// so React.memo'd sidebar nodes can skip re-rendering subtrees that an edit
// didn't touch. Only the path to a changed item gets fresh references.
function mapTree(items: TreeItem[], fn: (item: TreeItem) => TreeItem): TreeItem[] {
  let changed = false;
  const next = items.map((item) => {
    const mapped = fn(item);
    if (mapped.type === 'folder') {
      const kids = mapTree(mapped.items, fn);
      const folder = kids === mapped.items ? mapped : { ...mapped, items: kids };
      if (folder !== item) changed = true;
      return folder;
    }
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
}

// Ids of every ancestor folder (root-first) containing `id`, or null if `id`
// isn't found under `items` at all. Used by revealRequest below.
function findAncestorPath(items: TreeItem[], id: string, path: string[] = []): string[] | null {
  for (const it of items) {
    if (it.id === id) return path;
    if (it.type === 'folder') {
      const found = findAncestorPath(it.items, id, [...path, it.id]);
      if (found) return found;
    }
  }
  return null;
}

function removeFromTree(items: TreeItem[], id: string): TreeItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) => (item.type === 'folder' ? { ...item, items: removeFromTree(item.items, id) } : item));
}

// Insert `child` into the folder/collection with `parentId`. When parentId is
// null the child goes at the collection root (handled by the caller).
function insertIntoTree(items: TreeItem[], parentId: string, child: TreeItem): TreeItem[] {
  return items.map((item) => {
    if (item.type !== 'folder') return item;
    if (item.id === parentId) return { ...item, items: [...item.items, child], collapsed: false };
    return { ...item, items: insertIntoTree(item.items, parentId, child) };
  });
}

// Deep-clone a tree item with fresh ids throughout.
function cloneTreeItem(item: TreeItem): TreeItem {
  if (item.type === 'folder') return { ...item, id: uid(), items: item.items.map(cloneTreeItem) };
  return newRequest({ ...item });
}

// Append a fresh clone of `itemId` next to it (same parent list).
function insertSiblingClone(items: TreeItem[], itemId: string): TreeItem[] {
  const orig = items.find((i) => i.id === itemId);
  if (orig) return [...items, cloneTreeItem(orig)];
  return items.map((i) => (i.type === 'folder' ? { ...i, items: insertSiblingClone(i.items, itemId) } : i));
}

function containsId(item: TreeItem, id: string): boolean {
  if (item.id === id) return true;
  return item.type === 'folder' && item.items.some((c) => containsId(c, id));
}

// Read-only lookup, for copy — unlike extractItem this leaves the tree untouched.
function findItem(items: TreeItem[], id: string): TreeItem | null {
  for (const it of items) {
    if (it.id === id) return it;
    if (it.type === 'folder') { const r = findItem(it.items, id); if (r) return r; }
  }
  return null;
}

// Remove `id` from the tree, capturing the removed item.
function extractItem(items: TreeItem[], id: string): { items: TreeItem[]; found: TreeItem | null } {
  let found: TreeItem | null = null;
  const next: TreeItem[] = [];
  for (const it of items) {
    if (it.id === id) { found = it; continue; }
    if (it.type === 'folder') {
      const r = extractItem(it.items, id);
      if (r.found) found = r.found;
      next.push({ ...it, items: r.items });
    } else next.push(it);
  }
  return { items: next, found };
}

// Insert `node` relative to `targetId` (before/after sibling, or inside a folder).
function insertRelative(items: TreeItem[], targetId: string, node: TreeItem, where: 'before' | 'after' | 'inside'): { items: TreeItem[]; done: boolean } {
  const out: TreeItem[] = [];
  let done = false;
  for (const it of items) {
    if (!done && it.id === targetId) {
      if (where === 'before') { out.push(node, it); done = true; continue; }
      if (where === 'after') { out.push(it, node); done = true; continue; }
      if (where === 'inside' && it.type === 'folder') { out.push({ ...it, items: [...it.items, node], collapsed: false }); done = true; continue; }
    }
    if (!done && it.type === 'folder') {
      const r = insertRelative(it.items, targetId, node, where);
      if (r.done) { out.push({ ...it, items: r.items }); done = true; continue; }
    }
    out.push(it);
  }
  return { items: out, done };
}

// Backfill the params table from the URL's query for requests saved before the
// URL⇄params sync (or imported), so the Params tab reflects the URL on open.
function syncParams(req: ApiRequest): ApiRequest {
  if (req.params.length === 0 && req.url.includes('?')) {
    const params = paramsFromUrl(req.url, []);
    if (params.length) return { ...req, params };
  }
  return req;
}

function findRequest(items: TreeItem[], id: string): ApiRequest | null {
  for (const item of items) {
    if (item.id === id && item.type === 'request') return item;
    if (item.type === 'folder') {
      const found = findRequest(item.items, id);
      if (found) return found;
    }
  }
  return null;
}

// Find a request by id and return the folder chain leading to it (outer→inner).
function findFolderPath(items: TreeItem[], id: string, acc: Folder[]): Folder[] | null {
  for (const item of items) {
    if (item.id === id && item.type === 'request') return acc;
    if (item.type === 'folder') {
      const found = findFolderPath(item.items, id, [...acc, item]);
      if (found) return found;
    }
  }
  return null;
}

export interface InheritedScripts { pre: string[]; post: string[]; auth: Auth | null; headers: KeyValue[][] }

// Ordered ancestor scripts for a request: pre runs collection→folders (outer to
// inner); post runs the reverse (inner to outer) so cleanup unwinds naturally.
// `auth` is the nearest ancestor (folder before collection) with concrete auth.
// `headers` stays outer→inner (collection first) — request.ts's buildHeaders
// applies them in that order so an inner folder's header overrides the
// collection's, matching Bruno.
function collectInherited(collections: Collection[], id: string): InheritedScripts {
  for (const c of collections) {
    const path = findFolderPath(c.items, id, []);
    if (path) {
      const nodes: { script?: { req: string; res: string }; auth?: Auth; headers?: KeyValue[] }[] = [c, ...path];
      const pre = nodes.map((n) => n.script?.req ?? '').filter((s) => s.trim());
      const post = nodes.map((n) => n.script?.res ?? '').filter((s) => s.trim()).reverse();
      const headers = nodes.map((n) => n.headers ?? []).filter((h) => h.length);
      let auth: Auth | null = null;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const a = nodes[i].auth;
        if (a && a.type !== 'none' && a.type !== 'inherit') { auth = a; break; }
      }
      return { pre, post, auth, headers };
    }
  }
  return { pre: [], post: [], auth: null, headers: [] };
}

// The owning collection's shared variable defaults for a request, looked up by
// request id (not the "active collection") so this stays correct for requests
// run from the Runner, which may not belong to whatever collection happens to
// be focused in the sidebar.
function findOwningCollectionId(collections: Collection[], id: string): string | null {
  for (const c of collections) {
    if (findRequest(c.items, id)) return c.id;
  }
  return null;
}

// Resolve which environments actually apply to a given request — the
// collection env remembered for the request's own *owning* collection, and
// the (collection-independent) global env — looked up by request id rather
// than "whatever tab is active", so a Runner run of one collection can never
// pick up a *different* collection's scoped environment just because that
// other collection's tab happened to be open. There's no "mismatch" case
// here any more: each collection only ever resolves its own remembered
// choice, never someone else's.
function resolveEnvsForRequest(
  collections: Collection[],
  environments: Environment[],
  activeEnvByCollection: Record<string, string>,
  activeGlobalEnvId: string | null,
  id: string,
): { collectionEnv: Environment | null; globalEnv: Environment | null } {
  const owningCollectionId = findOwningCollectionId(collections, id);
  const collectionEnvId = owningCollectionId ? activeEnvByCollection[owningCollectionId] : undefined;
  const collectionEnv = collectionEnvId
    ? environments.find((e) => e.id === collectionEnvId && e.collectionId === owningCollectionId) ?? null
    : null;
  const globalEnv = activeGlobalEnvId ? environments.find((e) => e.id === activeGlobalEnvId) ?? null : null;
  return { collectionEnv, globalEnv };
}

// One-time migration from the old single "active environment" selection
// (`devtool:apiclient:activeEnv`, one id shared across the whole app) into
// the new per-collection-memory + separate-global model. Reads the legacy
// key directly (bypassing usePersistentState, which only ever reads a key
// once per fresh state) so an upgrading user's current choice survives
// instead of silently resetting to "No Environment" everywhere. Only
// consulted when the *new* key is still empty (see the `initial` argument
// at each usePersistentState call below) — a no-op once migrated, and a
// no-op for anyone whose legacy selection was already cleared or unknown.
function migrateLegacyActiveEnv(environments: Environment[]): { byCollection: Record<string, string>; global: string | null } {
  try {
    const raw = storageGet('devtool:apiclient:activeEnv');
    if (raw === null) return { byCollection: {}, global: null };
    const legacyId = JSON.parse(raw) as string | null;
    const env = legacyId ? environments.find((e) => e.id === legacyId) : null;
    if (!env) return { byCollection: {}, global: null };
    return env.collectionId
      ? { byCollection: { [env.collectionId]: env.id }, global: null }
      : { byCollection: {}, global: env.id };
  } catch {
    return { byCollection: {}, global: null };
  }
}

function collectCollectionVars(collections: Collection[], id: string): VarMap {
  for (const c of collections) {
    if (!findFolderPath(c.items, id, [])) continue;
    const map: VarMap = {};
    for (const v of c.variables ?? []) if (v.enabled && v.key) map[v.key] = v.value;
    return map;
  }
  return {};
}

// Vars (collection var + global env + collection env) for a collection/folder's
// own settings dialog (headers/auth) — keyed directly by the *collection* id
// rather than a descendant request id, since a collection/folder node has no
// request id of its own for `collectCollectionVars`/`resolveEnvsForRequest` to
// look up. Same precedence as the per-request `varMap` (ApiClient.tsx):
// collection env overrides global env overrides collection var. Used so a
// {{token}} referencing a Collection Variable or either active environment
// shows as *known* while editing that collection's own inherited
// headers/auth, not just while editing an actual request.
function varsForCollection(
  collections: Collection[],
  environments: Environment[],
  activeEnvByCollection: Record<string, string>,
  activeGlobalEnvId: string | null,
  collectionId: string,
): VarMap {
  const map: VarMap = {};
  const collection = collections.find((c) => c.id === collectionId);
  for (const v of collection?.variables ?? []) if (v.enabled && v.key) map[v.key] = v.value;
  const globalEnv = activeGlobalEnvId ? environments.find((e) => e.id === activeGlobalEnvId) : null;
  if (globalEnv) for (const v of globalEnv.variables) if (v.enabled && v.key) map[v.key] = v.secret ? '••••••••' : v.value;
  const collectionEnvId = activeEnvByCollection[collectionId];
  const collectionEnv = collectionEnvId
    ? environments.find((e) => e.id === collectionEnvId && e.collectionId === collectionId)
    : null;
  if (collectionEnv) for (const v of collectionEnv.variables) if (v.enabled && v.key) map[v.key] = v.secret ? '••••••••' : v.value;
  return map;
}

// ─── store hook ─────────────────────────────────────────────────────────────

export function useApiStore() {
  // The collections tree is edited on every keystroke, so debounce its (large)
  // serialization rather than writing the whole tree to localStorage each time.
  const [collections, setCollections] = usePersistentState<Collection[]>(
    'devtool:apiclient:collections', seedCollections, { debounceMs: 400 },
  );
  const [environments, setEnvironments] = usePersistentState<Environment[]>(
    'devtool:apiclient:environments', [], { debounceMs: 300 },
  );
  // Per-collection remembered choice (collectionId -> envId) and the single,
  // collection-independent global choice — replaces the old single
  // `activeEnvId`. Both `initial` args only ever run once, and only when
  // their own key has never been written — see migrateLegacyActiveEnv.
  const [activeEnvByCollection, setActiveEnvByCollection] = usePersistentState<Record<string, string>>(
    'devtool:apiclient:activeEnvByCollection', () => migrateLegacyActiveEnv(environments).byCollection,
  );
  const [activeGlobalEnvId, setActiveGlobalEnvId] = usePersistentState<string | null>(
    'devtool:apiclient:activeGlobalEnv', () => migrateLegacyActiveEnv(environments).global,
  );
  const [history, setHistory] = usePersistentState<HistoryEntry[]>(
    'devtool:apiclient:history', [], { debounceMs: 500 },
  );
  const [activeRequestId, setActiveRequestId] = usePersistentState<string | null>(
    'devtool:apiclient:activeRequest', null,
  );
  // Requests open as tabs, in tab order. activeRequestId points at the focused one.
  const [openTabIds, setOpenTabIds] = usePersistentState<string[]>(
    'devtool:apiclient:openTabs', [],
  );
  // Cookie jar: captured from responses, auto-sent to matching requests.
  const [cookies, setCookies] = usePersistentState<Cookie[]>(
    'devtool:apiclient:cookies', [], { debounceMs: 300 },
  );
  const [cookiesEnabled, setCookiesEnabled] = usePersistentState<boolean>(
    'devtool:apiclient:cookiesEnabled', true,
  );
  // Local-only secret store, kept separate from environments (Postman's
  // "Vault"). Never touched by import/export or collection scripts — only
  // resolved into the actual outgoing request at send time (see engine.ts).
  const [vault, setVault] = usePersistentState<KeyValue[]>(
    'devtool:apiclient:vault', [], { debounceMs: 300 },
  );

  // Vault secrets namespaced as `vault.<key>` for {{ }} substitution.
  const vaultVars = useMemo(() => {
    const map: VarMap = {};
    for (const v of vault) if (v.enabled && v.key) map[`vault.${v.key}`] = v.value;
    return map;
  }, [vault]);

  // Normalizes on read so requests saved before scripting existed never crash
  // the editor (missing script/vars/assertions/tests are backfilled).
  const lookupRequest = useCallback((id: string): ApiRequest | null => {
    for (const c of collections) {
      const found = findRequest(c.items, id);
      if (found) return syncParams(normalizeRequest(found));
    }
    return null;
  }, [collections]);

  const activeRequest = useMemo(
    () => (activeRequestId ? lookupRequest(activeRequestId) : null),
    [activeRequestId, lookupRequest],
  );

  // The collection the user is currently working in — used to scope which
  // collection environments are available alongside the global ones.
  const activeCollectionId = useMemo(() => {
    if (activeRequestId) {
      const c = collections.find((col) => findRequest(col.items, activeRequestId));
      if (c) return c.id;
    }
    return collections[0]?.id ?? null;
  }, [collections, activeRequestId]);

  // The collection environment remembered for whichever collection is
  // currently active — automatically follows the active request's own
  // collection, never a stale choice left over from a different one, because
  // it's looked up fresh from that collection's own map entry every time.
  const activeCollectionEnv = useMemo(() => {
    if (!activeCollectionId) return null;
    const id = activeEnvByCollection[activeCollectionId];
    if (!id) return null;
    const env = environments.find((e) => e.id === id);
    return env && env.collectionId === activeCollectionId ? env : null;
  }, [environments, activeEnvByCollection, activeCollectionId]);

  // The single global environment, unaffected by which collection is active.
  const activeGlobalEnv = useMemo(
    () => (activeGlobalEnvId ? environments.find((e) => e.id === activeGlobalEnvId) ?? null : null),
    [environments, activeGlobalEnvId],
  );

  // True when `env` is the winning choice in its own scope — the collection
  // slot for a collection-scoped environment, the single global slot for a
  // global one. Used for the active-dot in environment lists and the
  // Active/Set active toggle, so both scopes share one "is this the one"
  // check instead of two ad hoc comparisons scattered across the UI.
  const isEnvActive = useCallback((env: Environment) => (
    env.collectionId
      ? activeEnvByCollection[env.collectionId] === env.id
      : activeGlobalEnvId === env.id
  ), [activeEnvByCollection, activeGlobalEnvId]);

  const setActiveCollectionEnv = useCallback((collectionId: string, envId: string | null) => {
    setActiveEnvByCollection((prev) => {
      if (envId === null) {
        if (!(collectionId in prev)) return prev;
        const next = { ...prev };
        delete next[collectionId];
        return next;
      }
      return prev[collectionId] === envId ? prev : { ...prev, [collectionId]: envId };
    });
  }, [setActiveEnvByCollection]);

  const setActiveGlobalEnv = useCallback((envId: string | null) => {
    setActiveGlobalEnvId(envId);
  }, [setActiveGlobalEnvId]);

  // Open tabs resolved to live requests, dropping any that were deleted.
  const openRequests = useMemo(
    () => openTabIds.map(lookupRequest).filter((r): r is ApiRequest => r !== null),
    [openTabIds, lookupRequest],
  );

  // Open (or focus) a request in a tab.
  const selectRequest = useCallback((id: string) => {
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveRequestId(id);
  }, [setOpenTabIds, setActiveRequestId]);

  // Close a tab; if it was active, focus the neighbour that takes its place.
  const closeTab = useCallback((id: string) => {
    setOpenTabIds((prev) => {
      const idx = prev.indexOf(id);
      const next = prev.filter((t) => t !== id);
      setActiveRequestId((cur) => {
        if (cur !== id) return cur;
        return next[idx] ?? next[idx - 1] ?? null;
      });
      return next;
    });
  }, [setOpenTabIds, setActiveRequestId]);

  // Close several tabs at once (the tab strip's Close Others / Close to the
  // Right / Close All). One state update, not a closeTab() per id: each of
  // those would re-pick the "neighbour" active tab in turn, and the tab that
  // ends up focused after closing five in a row is whatever the fifth
  // pick landed on, not the one the user kept. If the active tab survives it
  // stays active; otherwise the nearest survivor to where it was takes over.
  const closeTabs = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setOpenTabIds((prev) => {
      const next = prev.filter((t) => !gone.has(t));
      setActiveRequestId((cur) => {
        if (cur && !gone.has(cur)) return cur;
        if (!cur) return null;
        const idx = prev.indexOf(cur);
        // Survivors before `idx` in the old order keep their positions; the
        // one that took the closed tab's slot (or the last one) is nearest.
        const before = prev.slice(0, idx).filter((t) => !gone.has(t)).length;
        return next[before] ?? next[before - 1] ?? null;
      });
      return next;
    });
  }, [setOpenTabIds, setActiveRequestId]);

  // — collection / tree ops —

  const addCollection = useCallback(() => {
    const c = newCollection();
    setCollections((prev) => [...prev, c]);
    return c.id;
  }, [setCollections]);

  const importCollection = useCallback((collection: Collection) => {
    setCollections((prev) => [...prev, collection]);
  }, [setCollections]);

  const deleteCollection = useCallback((id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    // Drop the collection's scoped environments too.
    setEnvironments((prev) => prev.filter((e) => e.collectionId !== id));
  }, [setCollections, setEnvironments]);

  const renameCollection = useCallback((id: string, name: string) => {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, [setCollections]);

  const toggleCollapse = useCallback((collectionId: string, itemId?: string) => {
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      if (!itemId) return { ...c, collapsed: !c.collapsed };
      return {
        ...c,
        items: mapTree(c.items, (item) =>
          item.id === itemId && item.type === 'folder' ? { ...item, collapsed: !item.collapsed } : item,
        ),
      };
    }));
  }, [setCollections]);

  // Force-expand the collection and every ancestor folder containing `id` —
  // an explicit "make sure this is visible", not a toggle. Called when a
  // request becomes active from outside the tree (reopening a tab, jumping
  // in from History or the Runner), so it's never left sitting invisible
  // behind a collapsed ancestor with no clue where it actually lives.
  // Identity-preserving (via mapTree) so selecting a request that's already
  // fully expanded is a no-op — no extra render, no extra persisted write.
  const revealRequest = useCallback((id: string) => {
    setCollections((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        const path = findAncestorPath(c.items, id);
        if (path === null) return c;
        const pathSet = new Set(path);
        const items = mapTree(c.items, (item) =>
          item.type === 'folder' && pathSet.has(item.id) && item.collapsed ? { ...item, collapsed: false } : item,
        );
        if (items === c.items && !c.collapsed) return c;
        changed = true;
        return { ...c, collapsed: false, items };
      });
      return changed ? next : prev;
    });
  }, [setCollections]);

  // Add a request (or folder) to a collection root, or into a folder by parentId.
  const addItem = useCallback((collectionId: string, kind: 'request' | 'folder', parentId?: string) => {
    const child: TreeItem = kind === 'request' ? newRequest() : newFolder();
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      if (!parentId) return { ...c, items: [...c.items, child], collapsed: false };
      return { ...c, items: insertIntoTree(c.items, parentId, child) };
    }));
    if (child.type === 'request') selectRequest(child.id);
    return child.id;
  }, [setCollections, selectRequest]);

  const deleteItem = useCallback((collectionId: string, itemId: string) => {
    setCollections((prev) => prev.map((c) =>
      c.id === collectionId ? { ...c, items: removeFromTree(c.items, itemId) } : c,
    ));
    closeTab(itemId);
  }, [setCollections, closeTab]);

  const renameItem = useCallback((itemId: string, name: string) => {
    setCollections((prev) => prev.map((c) => ({
      ...c,
      items: mapTree(c.items, (item) => (item.id === itemId ? { ...item, name } : item)),
    })));
  }, [setCollections]);

  // Set the inherited script on a collection (nodeId null) or a folder.
  const setNodeScript = useCallback((collectionId: string, nodeId: string | null, script: RequestScript) => {
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      if (!nodeId) return { ...c, script };
      return {
        ...c,
        items: mapTree(c.items, (item) =>
          item.id === nodeId && item.type === 'folder' ? { ...item, script } : item,
        ),
      };
    }));
  }, [setCollections]);

  const setNodeAuth = useCallback((collectionId: string, nodeId: string | null, auth: Auth) => {
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      if (!nodeId) return { ...c, auth };
      return {
        ...c,
        items: mapTree(c.items, (item) =>
          item.id === nodeId && item.type === 'folder' ? { ...item, auth } : item,
        ),
      };
    }));
  }, [setCollections]);

  const setCollectionVariables = useCallback((collectionId: string, variables: KeyValue[]) => {
    setCollections((prev) => prev.map((c) => (c.id === collectionId ? { ...c, variables } : c)));
  }, [setCollections]);

  // Set the inherited headers on a collection (nodeId null) or a folder.
  const setNodeHeaders = useCallback((collectionId: string, nodeId: string | null, headers: KeyValue[]) => {
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      if (!nodeId) return { ...c, headers };
      return {
        ...c,
        items: mapTree(c.items, (item) =>
          item.id === nodeId && item.type === 'folder' ? { ...item, headers } : item,
        ),
      };
    }));
  }, [setCollections]);

  // Inherited scripts/auth for any request id (used by the Runner).
  const getInherited = useCallback((id: string) => collectInherited(collections, id), [collections]);

  // Inherited (collection + folder) scripts for the request currently active.
  const inheritedScripts = useMemo(
    () => (activeRequestId ? collectInherited(collections, activeRequestId) : { pre: [], post: [], auth: null, headers: [] }),
    [collections, activeRequestId],
  );

  // Collection variables for any request id (used by the Runner).
  const getCollectionVars = useCallback(
    (id: string) => collectCollectionVars(collections, id),
    [collections],
  );

  // Vars (collection var + global env + collection env) for a
  // collection/folder's own settings dialog — see `varsForCollection`. Used
  // for {{}} highlighting in the collection/folder Headers and Auth tabs,
  // keyed by collection id rather than the (possibly unrelated) currently-open tab.
  const getVarsForCollection = useCallback(
    (collectionId: string) => varsForCollection(collections, environments, activeEnvByCollection, activeGlobalEnvId, collectionId),
    [collections, environments, activeEnvByCollection, activeGlobalEnvId],
  );

  // The environments that actually apply to a given request id (used by the
  // Runner and the plain Send path) — never a collection-scoped environment
  // that only happens to be remembered for a *different* collection whose
  // tab is merely open. See `resolveEnvsForRequest`.
  const getEnvsForRequest = useCallback(
    (id: string) => resolveEnvsForRequest(collections, environments, activeEnvByCollection, activeGlobalEnvId, id),
    [collections, environments, activeEnvByCollection, activeGlobalEnvId],
  );

  // The collection a request belongs to, regardless of which tab/collection
  // is merely "active" — used to persist a script's collection-var writes
  // back into the right bag.
  const getOwningCollectionId = useCallback(
    (id: string) => findOwningCollectionId(collections, id),
    [collections],
  );

  // Collection variables for the request currently active.
  const activeCollectionVars = useMemo(
    () => (activeRequestId ? collectCollectionVars(collections, activeRequestId) : {}),
    [collections, activeRequestId],
  );

  // Insert an already-built request (e.g. a cURL import) and focus it.
  const addRequest = useCallback((collectionId: string, request: ApiRequest, parentId?: string) => {
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      if (!parentId) return { ...c, items: [...c.items, request], collapsed: false };
      return { ...c, items: insertIntoTree(c.items, parentId, request) };
    }));
    selectRequest(request.id);
  }, [setCollections, selectRequest]);

  // Move a request/folder to a new spot (drag & drop). `targetId` may be a
  // collection, folder, or request; `where` is before/after a sibling or inside
  // a folder/collection.
  const moveItem = useCallback((sourceId: string, targetId: string, where: 'before' | 'after' | 'inside') => {
    if (sourceId === targetId) return;
    setCollections((prev) => {
      let captured: TreeItem | null = null;
      const stripped = prev.map((c) => { const r = extractItem(c.items, sourceId); if (r.found) captured = r.found; return { ...c, items: r.items }; });
      if (!captured) return prev;
      // Don't drop a folder into itself/its descendants.
      if (containsId(captured, targetId)) return prev;
      // Drop directly onto a collection → append at its root.
      if (stripped.some((c) => c.id === targetId)) {
        return stripped.map((c) => (c.id === targetId ? { ...c, items: [...c.items, captured!], collapsed: false } : c));
      }
      let inserted = false;
      const next = stripped.map((c) => {
        if (inserted) return c;
        const r = insertRelative(c.items, targetId, captured!, where);
        if (r.done) { inserted = true; return { ...c, items: r.items }; }
        return c;
      });
      return inserted ? next : prev;
    });
  }, [setCollections]);

  // Copy a request/folder to a new spot (drag & drop with the copy modifier
  // held) — like moveItem, but the source stays put and the destination gets a
  // deep clone with fresh ids. Can land in a different collection than the
  // source, unlike cloneItem (which always clones next to the original).
  const copyItem = useCallback((sourceId: string, targetId: string, where: 'before' | 'after' | 'inside') => {
    if (sourceId === targetId) return;
    setCollections((prev) => {
      let source: TreeItem | null = null;
      for (const c of prev) { source = findItem(c.items, sourceId); if (source) break; }
      if (!source) return prev;
      const copy = cloneTreeItem(source);
      // Drop directly onto a collection → append at its root.
      if (prev.some((c) => c.id === targetId)) {
        return prev.map((c) => (c.id === targetId ? { ...c, items: [...c.items, copy], collapsed: false } : c));
      }
      let inserted = false;
      const next = prev.map((c) => {
        if (inserted) return c;
        const r = insertRelative(c.items, targetId, copy, where);
        if (r.done) { inserted = true; return { ...c, items: r.items }; }
        return c;
      });
      return inserted ? next : prev;
    });
  }, [setCollections]);

  // Clone a folder or request (deep, new ids) next to itself.
  const cloneItem = useCallback((collectionId: string, itemId: string) => {
    setCollections((prev) => prev.map((c) =>
      c.id === collectionId ? { ...c, items: insertSiblingClone(c.items, itemId) } : c,
    ));
  }, [setCollections]);

  // Clone a whole collection (deep, new ids) right after it.
  const cloneCollection = useCallback((id: string) => {
    setCollections((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const src = prev[idx];
      const copy: Collection = { ...src, id: uid(), name: `${src.name} copy`, items: src.items.map(cloneTreeItem) };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, [setCollections]);

  // Apply a partial patch to whichever request matches `id`, anywhere in the tree.
  // Collections that don't contain the request keep their identity untouched, so
  // editing a request only re-renders that request's node path in the sidebar.
  const updateRequest = useCallback((id: string, patch: Partial<ApiRequest>) => {
    setCollections((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        const items = mapTree(c.items, (item) =>
          item.id === id && item.type === 'request' ? { ...item, ...patch } : item,
        );
        if (items === c.items) return c;
        changed = true;
        return { ...c, items };
      });
      return changed ? next : prev;
    });
  }, [setCollections]);

  // — environment ops —

  const addEnvironment = useCallback((collectionId: string | null = null) => {
    const e = newEnvironment('New Environment', collectionId);
    setEnvironments((prev) => [...prev, e]);
    return e.id;
  }, [setEnvironments]);

  // Clone an environment (same scope, "<name> copy", every variable row given
  // a fresh id so the two environments never share row identity) — the usual
  // way to start a staging environment from prod without retyping every
  // variable by hand.
  const duplicateEnvironment = useCallback((id: string) => {
    const source = environments.find((e) => e.id === id);
    if (!source) return null;
    const copy: Environment = {
      ...source,
      id: uid(),
      name: `${source.name} copy`,
      variables: source.variables.map((v) => ({ ...v, id: uid() })),
    };
    setEnvironments((prev) => [...prev, copy]);
    return copy.id;
  }, [environments, setEnvironments]);

  // Adds an already-built Environment (e.g. from environments-io.ts's
  // importEnvironment) as a new entry, keeping its id — the caller is
  // responsible for generating a fresh one so this can't collide.
  const importEnvironment = useCallback((env: Environment) => {
    setEnvironments((prev) => [...prev, env]);
    return env.id;
  }, [setEnvironments]);

  const updateEnvironment = useCallback((id: string, patch: Partial<Environment>) => {
    setEnvironments((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, [setEnvironments]);

  const deleteEnvironment = useCallback((id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    setActiveEnvByCollection((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [collId, envId] of Object.entries(next)) {
        if (envId === id) { delete next[collId]; changed = true; }
      }
      return changed ? next : prev;
    });
    setActiveGlobalEnvId((cur) => (cur === id ? null : cur));
  }, [setEnvironments, setActiveEnvByCollection, setActiveGlobalEnvId]);

  // — history —

  const addHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'at'>, sensitiveValues: string[] = []) => {
    const lean = trimHistoryEntry(entry, sensitiveValues);
    setHistory((prev) => [{ ...lean, id: uid(), at: Date.now() }, ...prev].slice(0, MAX_HISTORY));
  }, [setHistory]);

  const clearHistory = useCallback(() => setHistory([]), [setHistory]);

  // — cookies —

  // Capture Set-Cookie from a response at `url` into the jar (no-op if disabled).
  const captureCookies = useCallback((url: string, raws: string[]) => {
    if (!raws.length) return;
    setCookies((prev) => applySetCookies(prev, raws, url));
  }, [setCookies]);

  // Upsert a single cookie (manual add/edit from the cookie manager).
  const upsertCookie = useCallback((cookie: Cookie, replaces?: Cookie) => {
    setCookies((prev) => {
      const same = (a: Cookie, b: Cookie) => a.domain === b.domain && a.path === b.path && a.name === b.name;
      const target = replaces ?? cookie;
      const next = prev.filter((c) => !same(c, target));
      next.push(cookie);
      return next;
    });
  }, [setCookies]);

  const deleteCookie = useCallback((cookie: Cookie) => {
    setCookies((prev) => prev.filter((c) => !(c.domain === cookie.domain && c.path === cookie.path && c.name === cookie.name)));
  }, [setCookies]);

  const clearDomainCookies = useCallback((domain: string) => {
    setCookies((prev) => prev.filter((c) => c.domain !== domain));
  }, [setCookies]);

  const clearCookies = useCallback(() => setCookies([]), [setCookies]);

  return {
    collections, environments,
    activeEnvByCollection, activeGlobalEnvId, activeCollectionEnv, activeGlobalEnv, isEnvActive,
    history, activeCollectionId,
    activeRequestId, activeRequest, openRequests, inheritedScripts, activeCollectionVars,
    setActiveRequestId, setActiveCollectionEnv, setActiveGlobalEnv, selectRequest, closeTab, closeTabs,
    addCollection, importCollection, deleteCollection, renameCollection, toggleCollapse, revealRequest,
    addItem, addRequest, deleteItem, renameItem, cloneItem, cloneCollection, moveItem, copyItem, updateRequest, setNodeScript, setNodeAuth,
    setNodeHeaders,
    setCollectionVariables,
    addEnvironment, duplicateEnvironment, importEnvironment, updateEnvironment, deleteEnvironment,
    vault, setVault, vaultVars,
    addHistory, clearHistory, getInherited, getCollectionVars, getEnvsForRequest, getOwningCollectionId, getVarsForCollection,
    cookies, cookiesEnabled, setCookiesEnabled,
    captureCookies, upsertCookie, deleteCookie, clearDomainCookies, clearCookies,
  };
}

export type ApiStore = ReturnType<typeof useApiStore>;
