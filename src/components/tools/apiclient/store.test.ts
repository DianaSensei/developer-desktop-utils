import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newRequest } from './types';

const cache = new Map<string, string>();

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (cache.has(k) ? cache.get(k)! : null),
  storageSet: (k: string, v: string) => { cache.set(k, v); },
  flushPersistentStore: () => Promise.resolve(),
}));

beforeEach(() => {
  cache.clear();
});

describe('useApiStore — two-tier active environment (collection + global)', () => {
  it('activates a global environment regardless of which collection is active', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let envId = '';
    act(() => { envId = result.current.addEnvironment(null); }); // global
    act(() => result.current.setActiveGlobalEnv(envId));

    expect(result.current.activeGlobalEnv?.id).toBe(envId);
    expect(result.current.activeCollectionEnv).toBeNull();
  });

  it('switches the active collection env to the target collection\'s own remembered choice when the active request changes collections', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let firstEnvId = '';
    act(() => { firstEnvId = result.current.addEnvironment(firstCollectionId); });
    act(() => result.current.setActiveCollectionEnv(firstCollectionId, firstEnvId));

    let secondEnvId = '';
    act(() => { secondEnvId = result.current.addEnvironment(secondCollectionId); });
    act(() => result.current.setActiveCollectionEnv(secondCollectionId, secondEnvId));

    let firstRequestId = '';
    act(() => { firstRequestId = result.current.addItem(firstCollectionId, 'request'); });
    act(() => result.current.selectRequest(firstRequestId));
    expect(result.current.activeCollectionEnv?.id).toBe(firstEnvId);

    // Switching to a request in the *other* collection follows that
    // collection's own remembered choice — never a stale one carried over.
    let secondRequestId = '';
    act(() => { secondRequestId = result.current.addItem(secondCollectionId, 'request'); });
    act(() => result.current.selectRequest(secondRequestId));
    expect(result.current.activeCollectionId).toBe(secondCollectionId);
    expect(result.current.activeCollectionEnv?.id).toBe(secondEnvId);
  });

  it('resolves to "No Environment" for a collection that has no remembered choice, without touching another collection\'s', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let scopedEnvId = '';
    act(() => { scopedEnvId = result.current.addEnvironment(firstCollectionId); });
    act(() => result.current.setActiveCollectionEnv(firstCollectionId, scopedEnvId));

    let secondRequestId = '';
    act(() => { secondRequestId = result.current.addItem(secondCollectionId, 'request'); });
    act(() => result.current.selectRequest(secondRequestId));

    expect(result.current.activeCollectionId).toBe(secondCollectionId);
    expect(result.current.activeCollectionEnv).toBeNull();
  });

  it('keeps a global env active across a collection switch that also changes the collection env', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let globalEnvId = '';
    act(() => { globalEnvId = result.current.addEnvironment(null); });
    act(() => result.current.setActiveGlobalEnv(globalEnvId));

    let secondRequestId = '';
    act(() => { secondRequestId = result.current.addItem(secondCollectionId, 'request'); });
    act(() => result.current.selectRequest(secondRequestId));

    expect(result.current.activeCollectionId).toBe(secondCollectionId);
    expect(result.current.activeGlobalEnv?.id).toBe(globalEnvId);
  });

  it('isEnvActive reports true only for the winning environment in its own scope', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let collEnvId = '';
    act(() => { collEnvId = result.current.addEnvironment(collectionId); });
    let otherCollEnvId = '';
    act(() => { otherCollEnvId = result.current.addEnvironment(collectionId); });
    let globalEnvId = '';
    act(() => { globalEnvId = result.current.addEnvironment(null); });

    act(() => result.current.setActiveCollectionEnv(collectionId, collEnvId));
    act(() => result.current.setActiveGlobalEnv(globalEnvId));

    const collEnv = result.current.environments.find((e) => e.id === collEnvId)!;
    const otherCollEnv = result.current.environments.find((e) => e.id === otherCollEnvId)!;
    const globalEnv = result.current.environments.find((e) => e.id === globalEnvId)!;

    expect(result.current.isEnvActive(collEnv)).toBe(true);
    expect(result.current.isEnvActive(otherCollEnv)).toBe(false);
    expect(result.current.isEnvActive(globalEnv)).toBe(true);
  });

  it('getEnvsForRequest never applies a collection-scoped environment to another collection\'s request, regardless of which tab is active', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let scopedEnvId = '';
    act(() => { scopedEnvId = result.current.addEnvironment(firstCollectionId); });
    act(() => result.current.setActiveCollectionEnv(firstCollectionId, scopedEnvId));

    // Keep the *first* collection's request as the active tab (so
    // activeCollectionEnv itself resolves fine here) — the bug this guards is
    // a Runner-style run of the *other* collection's request while a
    // different tab is open.
    let firstRequestId = '';
    act(() => { firstRequestId = result.current.addItem(firstCollectionId, 'request'); });
    act(() => result.current.selectRequest(firstRequestId));
    expect(result.current.activeCollectionEnv?.id).toBe(scopedEnvId);

    let secondRequestId = '';
    act(() => { secondRequestId = result.current.addItem(secondCollectionId, 'request'); });

    // The environment is scoped to the first collection and must not leak
    // into a request that belongs to the second collection...
    expect(result.current.getEnvsForRequest(secondRequestId).collectionEnv).toBeNull();
    // ...but does still apply to a request in the collection it's scoped to.
    expect(result.current.getEnvsForRequest(firstRequestId).collectionEnv?.id).toBe(scopedEnvId);
  });

  it('getEnvsForRequest applies a global environment to any request', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let globalEnvId = '';
    act(() => { globalEnvId = result.current.addEnvironment(null); });
    act(() => result.current.setActiveGlobalEnv(globalEnvId));

    let requestId = '';
    act(() => { requestId = result.current.addItem(secondCollectionId, 'request'); });

    expect(result.current.getEnvsForRequest(requestId).globalEnv?.id).toBe(globalEnvId);
  });

  it('deleteEnvironment clears it from both the per-collection map and the global slot', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let collEnvId = '';
    act(() => { collEnvId = result.current.addEnvironment(collectionId); });
    let globalEnvId = '';
    act(() => { globalEnvId = result.current.addEnvironment(null); });
    act(() => result.current.setActiveCollectionEnv(collectionId, collEnvId));
    act(() => result.current.setActiveGlobalEnv(globalEnvId));

    act(() => result.current.deleteEnvironment(collEnvId));
    expect(result.current.activeEnvByCollection[collectionId]).toBeUndefined();

    act(() => result.current.deleteEnvironment(globalEnvId));
    expect(result.current.activeGlobalEnvId).toBeNull();
  });
});

describe('useApiStore — addHistory secret redaction', () => {
  it('leaves history untouched when no sensitive values are given', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    act(() => result.current.addHistory({
      method: 'GET', url: 'https://api.test/x', status: 200, ok: true, timeMs: 5,
      request: newRequest({ url: 'https://api.test/x' }),
      response: {
        status: 200, statusText: 'OK', ok: true, headers: [['X-Token', 's3cr3t-value']],
        body: 'token=s3cr3t-value', contentType: 'text/plain', timeMs: 5, sizeBytes: 10,
        url: 'https://api.test/x?token=s3cr3t-value',
      },
      tests: [], logs: [],
    }));

    const entry = result.current.history[0];
    expect(entry.response?.body).toBe('token=s3cr3t-value');
    expect(entry.response?.headers).toEqual([['X-Token', 's3cr3t-value']]);
  });

  it('redacts exact matches of sensitive values from the stored response body/headers/url', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    act(() => result.current.addHistory({
      method: 'GET', url: 'https://api.test/x', status: 200, ok: true, timeMs: 5,
      request: newRequest({ url: 'https://api.test/x' }),
      response: {
        status: 200, statusText: 'OK', ok: true, headers: [['X-Token', 's3cr3t-value']],
        body: 'echo: s3cr3t-value', contentType: 'text/plain', timeMs: 5, sizeBytes: 10,
        url: 'https://api.test/x?token=s3cr3t-value',
      },
      tests: [], logs: [],
    }, ['s3cr3t-value']));

    const entry = result.current.history[0];
    expect(entry.response?.body).toBe('echo: ••••••••');
    expect(entry.response?.headers).toEqual([['X-Token', '••••••••']]);
    expect(entry.response?.url).toBe('https://api.test/x?token=••••••••');
  });

  it('does not redact very short sensitive values (too likely to collide with ordinary text)', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    act(() => result.current.addHistory({
      method: 'GET', url: 'https://api.test/x', status: 200, ok: true, timeMs: 5,
      request: newRequest({ url: 'https://api.test/x' }),
      response: {
        status: 200, statusText: 'OK', ok: true, headers: [],
        body: 'ok', contentType: 'text/plain', timeMs: 5, sizeBytes: 2,
      },
      tests: [], logs: [],
    }, ['ok']));

    expect(result.current.history[0].response?.body).toBe('ok');
  });
});

describe('useApiStore — collection variables', () => {
  it('resolves the owning collection variables for a request id, not the "active" collection', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    act(() => result.current.setCollectionVariables(firstCollectionId, [
      { id: 'v1', key: 'host', value: 'first.test', enabled: true },
    ]));
    act(() => result.current.setCollectionVariables(secondCollectionId, [
      { id: 'v2', key: 'host', value: 'second.test', enabled: true },
    ]));

    let requestId = '';
    act(() => { requestId = result.current.addItem(firstCollectionId, 'request'); });

    let otherRequestId = '';
    act(() => { otherRequestId = result.current.addItem(secondCollectionId, 'request'); });
    // Make the *second* collection "active" by selecting a request that lives
    // there — getCollectionVars for the first request must still resolve to
    // the first collection's variables, not whichever collection is active.
    act(() => result.current.selectRequest(otherRequestId));

    expect(result.current.activeCollectionId).toBe(secondCollectionId);
    expect(result.current.getCollectionVars(requestId)).toEqual({ host: 'first.test' });
  });

  it('excludes disabled or empty-key rows from the resolved map', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    act(() => result.current.setCollectionVariables(collectionId, [
      { id: 'v1', key: 'host', value: 'api.test', enabled: true },
      { id: 'v2', key: 'off', value: 'x', enabled: false },
      { id: 'v3', key: '', value: 'y', enabled: true },
    ]));

    let requestId = '';
    act(() => { requestId = result.current.addItem(collectionId, 'request'); });
    expect(result.current.getCollectionVars(requestId)).toEqual({ host: 'api.test' });
  });

  it('tracks activeCollectionVars for the currently active request', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let requestId = '';
    act(() => { requestId = result.current.addItem(collectionId, 'request'); });
    act(() => result.current.selectRequest(requestId));
    act(() => result.current.setCollectionVariables(collectionId, [
      { id: 'v1', key: 'version', value: 'v2', enabled: true },
    ]));

    expect(result.current.activeCollectionVars).toEqual({ version: 'v2' });
  });
});

describe('useApiStore — getVarsForCollection', () => {
  it('resolves a collection\'s own variables regardless of which collection/tab is active', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    act(() => result.current.setCollectionVariables(firstCollectionId, [
      { id: 'v1', key: 'host', value: 'first.test', enabled: true },
    ]));

    // Make the *second* collection active — getVarsForCollection for the
    // first collection must still resolve its own variables, not the active
    // one's (or nothing at all, which is the bug this guards: a {{token}}
    // that already has a Collection Variable value showing as unresolved).
    let otherRequestId = '';
    act(() => { otherRequestId = result.current.addItem(secondCollectionId, 'request'); });
    act(() => result.current.selectRequest(otherRequestId));

    expect(result.current.activeCollectionId).toBe(secondCollectionId);
    expect(result.current.getVarsForCollection(firstCollectionId)).toEqual({ host: 'first.test' });
  });

  it('includes a global environment\'s variables', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let globalEnvId = '';
    act(() => { globalEnvId = result.current.addEnvironment(null); });
    act(() => result.current.updateEnvironment(globalEnvId, {
      variables: [{ id: 'v1', key: 'token', value: 'abc', enabled: true }],
    }));
    act(() => result.current.setActiveGlobalEnv(globalEnvId));

    expect(result.current.getVarsForCollection(collectionId)).toEqual({ token: 'abc' });
  });

  it('excludes an environment scoped to a different collection', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let scopedEnvId = '';
    act(() => { scopedEnvId = result.current.addEnvironment(firstCollectionId); });
    act(() => result.current.updateEnvironment(scopedEnvId, {
      variables: [{ id: 'v1', key: 'token', value: 'abc', enabled: true }],
    }));
    act(() => result.current.setActiveCollectionEnv(firstCollectionId, scopedEnvId));

    expect(result.current.getVarsForCollection(secondCollectionId)).toEqual({});
  });

  it('lets the environment override a collection variable of the same name', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    act(() => result.current.setCollectionVariables(collectionId, [
      { id: 'v1', key: 'host', value: 'from-collection', enabled: true },
    ]));

    let envId = '';
    act(() => { envId = result.current.addEnvironment(collectionId); });
    act(() => result.current.updateEnvironment(envId, {
      variables: [{ id: 'v2', key: 'host', value: 'from-env', enabled: true }],
    }));
    act(() => result.current.setActiveCollectionEnv(collectionId, envId));

    expect(result.current.getVarsForCollection(collectionId)).toEqual({ host: 'from-env' });
  });
});

describe('useApiStore — duplicateEnvironment', () => {
  it('clones the environment with a "copy" name, fresh ids, and the same scope', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let sourceId = '';
    act(() => { sourceId = result.current.addEnvironment(collectionId); });
    act(() => result.current.updateEnvironment(sourceId, {
      name: 'Prod',
      variables: [{ id: 'v1', key: 'host', value: 'prod.test', enabled: true }],
    }));

    let copyId: string | null = null;
    act(() => { copyId = result.current.duplicateEnvironment(sourceId); });

    expect(copyId).not.toBeNull();
    expect(copyId).not.toBe(sourceId);
    const copy = result.current.environments.find((e) => e.id === copyId);
    expect(copy?.name).toBe('Prod copy');
    expect(copy?.collectionId).toBe(collectionId);
    expect(copy?.variables).toEqual([{ id: expect.any(String), key: 'host', value: 'prod.test', enabled: true }]);
    expect(copy?.variables[0].id).not.toBe('v1');

    // The source is untouched, and both environments coexist independently.
    const source = result.current.environments.find((e) => e.id === sourceId);
    expect(source?.variables).toEqual([{ id: 'v1', key: 'host', value: 'prod.test', enabled: true }]);
    expect(result.current.environments).toHaveLength(2);
  });

  it('returns null for an unknown id and adds nothing', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const before = result.current.environments.length;
    let copyId: string | null = null;
    act(() => { copyId = result.current.duplicateEnvironment('does-not-exist'); });

    expect(copyId).toBeNull();
    expect(result.current.environments).toHaveLength(before);
  });
});

describe('useApiStore — collection/folder headers', () => {
  it('collects inherited headers outer (collection) to inner (folder) for a request', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    act(() => result.current.setNodeHeaders(collectionId, null, [
      { id: 'h1', key: 'X-Collection', value: 'collection', enabled: true },
    ]));

    let folderId = '';
    act(() => { folderId = result.current.addItem(collectionId, 'folder'); });
    act(() => result.current.setNodeHeaders(collectionId, folderId, [
      { id: 'h2', key: 'X-Folder', value: 'folder', enabled: true },
    ]));

    let requestId = '';
    act(() => { requestId = result.current.addItem(collectionId, 'request', folderId); });

    const { headers } = result.current.getInherited(requestId);
    expect(headers).toEqual([
      [{ id: 'h1', key: 'X-Collection', value: 'collection', enabled: true }],
      [{ id: 'h2', key: 'X-Folder', value: 'folder', enabled: true }],
    ]);
  });

  it('omits empty header lists and returns [] for a request with no ancestor headers', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let requestId = '';
    act(() => { requestId = result.current.addItem(collectionId, 'request'); });

    expect(result.current.getInherited(requestId).headers).toEqual([]);
  });
});

describe('useApiStore — importEnvironment', () => {
  it('appends an already-built Environment and it becomes selectable', async () => {
    const { useApiStore } = await import('./store');
    const { newEnvironment, newKeyValue } = await import('./types');
    const { result } = renderHook(() => useApiStore());

    const env = newEnvironment('Imported', null, [{ ...newKeyValue('host', 'imported.test'), enabled: true }]);
    let id = '';
    act(() => { id = result.current.importEnvironment(env); });

    expect(id).toBe(env.id);
    expect(result.current.environments.some((e) => e.id === env.id)).toBe(true);
    act(() => result.current.setActiveGlobalEnv(env.id));
    expect(result.current.activeGlobalEnv?.variables[0]).toMatchObject({ key: 'host', value: 'imported.test' });
  });
});

describe('useApiStore — moveItem / copyItem (sidebar drag & drop)', () => {
  it('reorders two requests within the same collection', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    // Start from an empty collection — the default seed collection already
    // carries a sample request, which would just be a third, unrelated item.
    let collectionId = '';
    act(() => { collectionId = result.current.addCollection(); });
    let firstId = '';
    let secondId = '';
    act(() => { firstId = result.current.addItem(collectionId, 'request'); });
    act(() => { secondId = result.current.addItem(collectionId, 'request'); });

    // Drag the second request to before the first.
    act(() => result.current.moveItem(secondId, firstId, 'before'));

    const ids = result.current.collections.find((c) => c.id === collectionId)!.items.map((i) => i.id);
    expect(ids).toEqual([secondId, firstId]);
  });

  it('moveItem relocates a request into a different collection, removing it from the source', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const sourceId = result.current.collections[0].id;
    let targetId = '';
    act(() => { targetId = result.current.addCollection(); });
    let requestId = '';
    act(() => { requestId = result.current.addItem(sourceId, 'request'); });

    act(() => result.current.moveItem(requestId, targetId, 'inside'));

    const source = result.current.collections.find((c) => c.id === sourceId)!;
    const target = result.current.collections.find((c) => c.id === targetId)!;
    expect(source.items.some((i) => i.id === requestId)).toBe(false);
    expect(target.items.some((i) => i.id === requestId)).toBe(true);
  });

  it('copyItem duplicates a request into another collection and leaves the original in place', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const sourceId = result.current.collections[0].id;
    let targetId = '';
    act(() => { targetId = result.current.addCollection(); });
    let requestId = '';
    act(() => { requestId = result.current.addItem(sourceId, 'request'); });
    act(() => result.current.renameItem(requestId, 'Original name'));

    act(() => result.current.copyItem(requestId, targetId, 'inside'));

    const source = result.current.collections.find((c) => c.id === sourceId)!;
    const target = result.current.collections.find((c) => c.id === targetId)!;
    // Original stays untouched in its own collection.
    expect(source.items.some((i) => i.id === requestId)).toBe(true);
    // Target gets an independent copy — new id, same name.
    expect(target.items).toHaveLength(1);
    expect(target.items[0].id).not.toBe(requestId);
    expect(target.items[0].name).toBe('Original name');
  });

  it('copyItem deep-clones a folder (with fresh ids for its children) rather than moving it', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const sourceId = result.current.collections[0].id;
    let targetId = '';
    act(() => { targetId = result.current.addCollection(); });
    let folderId = '';
    act(() => { folderId = result.current.addItem(sourceId, 'folder'); });
    let childId = '';
    act(() => { childId = result.current.addItem(sourceId, 'request', folderId); });

    act(() => result.current.copyItem(folderId, targetId, 'inside'));

    const source = result.current.collections.find((c) => c.id === sourceId)!;
    const target = result.current.collections.find((c) => c.id === targetId)!;
    expect(source.items.some((i) => i.id === folderId)).toBe(true);

    const copiedFolder = target.items[0];
    expect(copiedFolder.id).not.toBe(folderId);
    expect(copiedFolder.type).toBe('folder');
    if (copiedFolder.type === 'folder') {
      expect(copiedFolder.items).toHaveLength(1);
      expect(copiedFolder.items[0].id).not.toBe(childId);
    }
  });
});

describe('useApiStore — revealRequest (sidebar auto-expand on select)', () => {
  it('expands every collapsed ancestor folder and the collection containing the request', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let outerId = '';
    act(() => { outerId = result.current.addItem(collectionId, 'folder'); });
    let innerId = '';
    act(() => { innerId = result.current.addItem(collectionId, 'folder', outerId); });
    let requestId = '';
    act(() => { requestId = result.current.addItem(collectionId, 'request', innerId); });

    // Collapse everything on the way down, as if the user tucked it all away.
    act(() => result.current.toggleCollapse(collectionId));
    act(() => result.current.toggleCollapse(collectionId, outerId));
    act(() => result.current.toggleCollapse(collectionId, innerId));

    const findFolder = (id: string) => {
      const outer = result.current.collections.find((c) => c.id === collectionId)!.items
        .find((i) => i.id === outerId);
      const target = id === outerId ? outer : (outer && outer.type === 'folder' ? outer.items.find((i) => i.id === innerId) : undefined);
      return target && target.type === 'folder' ? target : undefined;
    };
    expect(result.current.collections.find((c) => c.id === collectionId)!.collapsed).toBe(true);
    expect(findFolder(outerId)?.collapsed).toBe(true);
    expect(findFolder(innerId)?.collapsed).toBe(true);

    act(() => result.current.revealRequest(requestId));

    expect(result.current.collections.find((c) => c.id === collectionId)!.collapsed).toBeFalsy();
    expect(findFolder(outerId)?.collapsed).toBe(false);
    expect(findFolder(innerId)?.collapsed).toBe(false);
  });

  it('is a no-op (same collections reference) when nothing was actually collapsed', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let requestId = '';
    act(() => { requestId = result.current.addItem(collectionId, 'request'); });

    const before = result.current.collections;
    act(() => result.current.revealRequest(requestId));
    expect(result.current.collections).toBe(before);
  });

  it('does nothing when the id does not belong to any collection', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const before = result.current.collections;
    act(() => result.current.revealRequest('does-not-exist'));
    expect(result.current.collections).toBe(before);
  });
});
