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
