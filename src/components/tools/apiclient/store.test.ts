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

describe('useApiStore — activeEnv collection scoping', () => {
  it('resolves the selected environment normally when it matches (or is global to) the active collection', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const collectionId = result.current.collections[0].id;
    let envId = '';
    act(() => { envId = result.current.addEnvironment(null); }); // global
    act(() => result.current.setActiveEnvId(envId));

    expect(result.current.activeEnv?.id).toBe(envId);
    expect(result.current.activeEnvMismatched).toBe(false);
    void collectionId;
  });

  it('treats a collection-scoped environment as inactive while working in a different collection', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const firstCollectionId = result.current.collections[0].id;
    let secondCollectionId = '';
    act(() => { secondCollectionId = result.current.addCollection(); });

    let scopedEnvId = '';
    act(() => { scopedEnvId = result.current.addEnvironment(firstCollectionId); });
    act(() => result.current.setActiveEnvId(scopedEnvId));

    // Move into a request that lives in the *other* collection.
    let requestId = '';
    act(() => { requestId = result.current.addItem(secondCollectionId, 'request'); });
    act(() => result.current.selectRequest(requestId));

    expect(result.current.activeCollectionId).toBe(secondCollectionId);
    expect(result.current.activeEnvMismatched).toBe(true);
    expect(result.current.activeEnv).toBeNull();
    // The raw selection is preserved (so the UI can still show/offer it), only
    // its *effect* on substitution is suppressed.
    expect(result.current.activeEnvId).toBe(scopedEnvId);
    expect(result.current.selectedEnv?.id).toBe(scopedEnvId);
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
    act(() => result.current.setActiveEnvId(env.id));
    expect(result.current.activeEnv?.variables[0]).toMatchObject({ key: 'host', value: 'imported.test' });
  });
});
