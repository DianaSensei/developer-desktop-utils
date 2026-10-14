import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from './types';

/** A Runner pass runs requests back to back: what one request's script
 *  writes (a login token) must reach the next, before React has re-rendered. */

const cache = new Map<string, string>();
vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (cache.has(k) ? cache.get(k)! : null),
  storageSet: (k: string, v: string) => { cache.set(k, v); },
  storageRemove: (k: string) => { cache.delete(k); },
  flushPersistentStore: () => Promise.resolve(),
}));

const executeRequest = vi.fn();
vi.mock('./engine', () => ({ executeRequest: (...args: unknown[]) => executeRequest(...args) }));

const ok = { status: 200, statusText: 'OK', ok: true, headers: [], body: '', contentType: '', timeMs: 1, sizeBytes: 0 };
const base = {
  response: ok, tests: [], logs: [], error: null,
  collectionEnvChanged: false, collectionEnvVars: {}, globalEnvChanged: false, globalEnvVars: {},
  collectionVarsChanged: false, collectionVars: {},
};

beforeEach(() => {
  cache.clear();
  executeRequest.mockReset();
});

async function setup() {
  const { useApiStore } = await import('./store');
  const { useApiRunner } = await import('./useApiRunner');
  const hook = renderHook(() => {
    const store = useApiStore();
    return { store, runner: useApiRunner(store, 5000) };
  });
  let envId = '';
  act(() => { envId = hook.result.current.store.addEnvironment(null); });
  act(() => hook.result.current.store.setActiveGlobalEnv(envId));
  return { hook, envId };
}

describe('useApiRunner', () => {
  it('a variable set by one request reaches the next in the same pass, and both writes are kept', async () => {
    const { hook, envId } = await setup();
    const req = hook.result.current.store.collections[0].items[0] as never;

    executeRequest
      .mockResolvedValueOnce({ ...base, globalEnvChanged: true, globalEnvVars: { token: 'T1' } })
      .mockResolvedValueOnce({ ...base, globalEnvChanged: true, globalEnvVars: { userId: '42' } });

    await act(async () => {
      const { runRequest } = hook.result.current.runner;
      await runRequest(req);
      await runRequest(req);
    });

    const secondGlobalEnv = executeRequest.mock.calls[1][2] as Environment;
    expect(secondGlobalEnv.variables.find((v) => v.key === 'token')?.value).toBe('T1');
    const saved = hook.result.current.store.environments.find((e) => e.id === envId)!;
    expect(Object.fromEntries(saved.variables.map((v) => [v.key, v.value]))).toMatchObject({ token: 'T1', userId: '42' });
  });

  it('an unknown environment id is an error, not a silent run without one', async () => {
    const { hook } = await setup();
    const req = hook.result.current.store.collections[0].items[0] as never;
    executeRequest.mockResolvedValue(base);
    await expect(hook.result.current.runner.runRequest(req, {}, undefined, 'typo-env')).rejects.toThrow(/No environment/);
    expect(executeRequest).not.toHaveBeenCalled();
  });
});
