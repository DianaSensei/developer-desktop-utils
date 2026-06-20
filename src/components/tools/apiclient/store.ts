// Persistent state for the API Client.
//
// Everything (collections, environments, history) is JSON-serializable and kept
// in localStorage via usePersistentState, so the workspace survives app
// restarts — consistent with the rest of DevTool. Tree edits are applied
// immutably through small recursive helpers.

import { useCallback, useMemo } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import {
  type ApiRequest,
  type Auth,
  type Collection,
  type Environment,
  type Folder,
  type HistoryEntry,
  type RequestScript,
  type TreeItem,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  normalizeRequest,
  uid,
} from './types';

const MAX_HISTORY = 50;
const MAX_HISTORY_BODY = 256 * 1024; // cap stored response bodies at 256 KB

// Keep history entries lean in localStorage: truncate huge response bodies and
// drop binary file payloads from the request snapshot (filenames are kept).
function trimHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'at'>): Omit<HistoryEntry, 'id' | 'at'> {
  const out = { ...entry };
  if (out.response && out.response.body.length > MAX_HISTORY_BODY) {
    out.response = { ...out.response, body: out.response.body.slice(0, MAX_HISTORY_BODY) };
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

function mapTree(items: TreeItem[], fn: (item: TreeItem) => TreeItem): TreeItem[] {
  return items.map((item) => {
    const mapped = fn(item);
    if (mapped.type === 'folder') {
      return { ...mapped, items: mapTree(mapped.items, fn) };
    }
    return mapped;
  });
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

export interface InheritedScripts { pre: string[]; post: string[]; auth: Auth | null }

// Ordered ancestor scripts for a request: pre runs collection→folders (outer to
// inner); post runs the reverse (inner to outer) so cleanup unwinds naturally.
// `auth` is the nearest ancestor (folder before collection) with concrete auth.
function collectInherited(collections: Collection[], id: string): InheritedScripts {
  for (const c of collections) {
    const path = findFolderPath(c.items, id, []);
    if (path) {
      const nodes: { script?: { req: string; res: string }; auth?: Auth }[] = [c, ...path];
      const pre = nodes.map((n) => n.script?.req ?? '').filter((s) => s.trim());
      const post = nodes.map((n) => n.script?.res ?? '').filter((s) => s.trim()).reverse();
      let auth: Auth | null = null;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const a = nodes[i].auth;
        if (a && a.type !== 'none' && a.type !== 'inherit') { auth = a; break; }
      }
      return { pre, post, auth };
    }
  }
  return { pre: [], post: [], auth: null };
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
  const [activeEnvId, setActiveEnvId] = usePersistentState<string | null>(
    'devtool:apiclient:activeEnv', null,
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

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === activeEnvId) ?? null,
    [environments, activeEnvId],
  );

  // Normalizes on read so requests saved before scripting existed never crash
  // the editor (missing script/vars/assertions/tests are backfilled).
  const lookupRequest = useCallback((id: string): ApiRequest | null => {
    for (const c of collections) {
      const found = findRequest(c.items, id);
      if (found) return normalizeRequest(found);
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

  // Inherited scripts/auth for any request id (used by the Runner).
  const getInherited = useCallback((id: string) => collectInherited(collections, id), [collections]);

  // Inherited (collection + folder) scripts for the request currently active.
  const inheritedScripts = useMemo(
    () => (activeRequestId ? collectInherited(collections, activeRequestId) : { pre: [], post: [], auth: null }),
    [collections, activeRequestId],
  );

  const duplicateRequest = useCallback((collectionId: string, req: ApiRequest) => {
    const copy = { ...newRequest({ ...req, name: `${req.name} copy` }) };
    setCollections((prev) => prev.map((c) =>
      c.id === collectionId ? { ...c, items: [...c.items, copy] } : c,
    ));
    selectRequest(copy.id);
  }, [setCollections, selectRequest]);

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
  const updateRequest = useCallback((id: string, patch: Partial<ApiRequest>) => {
    setCollections((prev) => prev.map((c) => ({
      ...c,
      items: mapTree(c.items, (item) =>
        item.id === id && item.type === 'request' ? { ...item, ...patch } : item,
      ),
    })));
  }, [setCollections]);

  // — environment ops —

  const addEnvironment = useCallback((collectionId: string | null = null) => {
    const e = newEnvironment('New Environment', collectionId);
    setEnvironments((prev) => [...prev, e]);
    return e.id;
  }, [setEnvironments]);

  const updateEnvironment = useCallback((id: string, patch: Partial<Environment>) => {
    setEnvironments((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, [setEnvironments]);

  const deleteEnvironment = useCallback((id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    setActiveEnvId((cur) => (cur === id ? null : cur));
  }, [setEnvironments, setActiveEnvId]);

  // — history —

  const addHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'at'>) => {
    const lean = trimHistoryEntry(entry);
    setHistory((prev) => [{ ...lean, id: uid(), at: Date.now() }, ...prev].slice(0, MAX_HISTORY));
  }, [setHistory]);

  const clearHistory = useCallback(() => setHistory([]), [setHistory]);

  return {
    collections, environments, activeEnvId, activeEnv, history, activeCollectionId,
    activeRequestId, activeRequest, openRequests, inheritedScripts,
    setActiveRequestId, setActiveEnvId, selectRequest, closeTab,
    addCollection, importCollection, deleteCollection, renameCollection, toggleCollapse,
    addItem, addRequest, deleteItem, renameItem, duplicateRequest, cloneItem, cloneCollection, moveItem, updateRequest, setNodeScript, setNodeAuth,
    addEnvironment, updateEnvironment, deleteEnvironment,
    addHistory, clearHistory, getInherited,
  };
}

export type ApiStore = ReturnType<typeof useApiStore>;
