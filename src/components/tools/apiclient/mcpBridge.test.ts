import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ApiStore } from './store';
import type { ApiRequest, Collection, Environment } from './types';
import { newRequest } from './types';

/**
 * `isTauri` (`@/lib/platform`) is computed once at module load from
 * `'__TAURI_INTERNALS__' in window`, so — same gotcha as
 * useTauriFileDrop.test.ts — it must be set BEFORE importing `mcpBridge.ts`,
 * with `vi.resetModules()` forcing a fresh load, or the bridge's effect
 * no-ops in plain jsdom.
 */

const listenMock = vi.fn();
const invokeMock = vi.fn();
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

type CallHandler = (event: { payload: { id: string; tool: string; args: Record<string, unknown> } }) => void;

async function renderBridge(store: ApiStore, runRequest: (...args: unknown[]) => unknown) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useMcpBridge } = await import('./mcpBridge');
  return renderHook(() => useMcpBridge(store, runRequest as never));
}

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return newRequest({ name: 'Get thing', method: 'GET', url: '/thing', ...overrides });
}

function makeStore(overrides: Partial<ApiStore> = {}): ApiStore {
  const req = makeRequest({});
  const collections: Collection[] = [{ id: 'c1', name: 'Demo', items: [req] }];
  const environments: Environment[] = [{ id: 'e1', name: 'Prod', variables: [], collectionId: null }];
  return {
    collections,
    environments,
    updateRequest: vi.fn(),
    addRequest: vi.fn(),
    deleteItem: vi.fn(),
    setNodeScript: vi.fn(),
    updateEnvironment: vi.fn(),
    setActiveGlobalEnv: vi.fn(),
    setActiveCollectionEnv: vi.fn(),
    ...overrides,
  } as unknown as ApiStore;
}

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('useMcpBridge — web build (no __TAURI_INTERNALS__)', () => {
  it('never registers a listener outside Tauri', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useMcpBridge } = await import('./mcpBridge');
    renderHook(() => useMcpBridge(makeStore(), vi.fn() as never));
    await new Promise((r) => setTimeout(r, 0));
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('useMcpBridge — Tauri desktop', () => {
  let capturedCb: CallHandler | undefined;

  beforeEach(() => {
    capturedCb = undefined;
    unlisten.mockClear();
    listenMock.mockImplementation((_event: string, cb: CallHandler) => {
      capturedCb = cb;
      return Promise.resolve(unlisten);
    });
  });

  let callSeq = 0;

  async function call(store: ApiStore, tool: string, args: Record<string, unknown>, runRequest: (...a: unknown[]) => unknown = vi.fn()) {
    await renderBridge(store, runRequest);
    await waitFor(() => expect(capturedCb).toBeDefined());
    const id = `call-${++callSeq}`;
    invokeMock.mockClear();
    capturedCb!({ payload: { id, tool, args } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('mcp_respond', expect.objectContaining({ id })));
    return invokeMock.mock.calls.find((c) => c[0] === 'mcp_respond' && (c[1] as { id: string }).id === id)?.[1] as { id: string; result: unknown; error: unknown };
  }

  it('registers exactly one mcp:call listener', async () => {
    await renderBridge(makeStore(), vi.fn());
    await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    expect(listenMock.mock.calls[0][0]).toBe('mcp:call');
  });

  it('list_collections returns a summarized tree', async () => {
    const store = makeStore();
    const res = await call(store, 'list_collections', {});
    expect(res.error).toBeNull();
    expect(res.result).toEqual([
      { id: 'c1', name: 'Demo', items: [{ id: store.collections[0].items[0].id, type: 'request', name: 'Get thing', method: 'GET', url: '/thing' }] },
    ]);
  });

  it('get_request finds a nested request and errors on an unknown id', async () => {
    const store = makeStore();
    const id = store.collections[0].items[0].id;
    const ok = await call(store, 'get_request', { requestId: id });
    expect(ok.error).toBeNull();
    expect((ok.result as ApiRequest).url).toBe('/thing');

    const bad = await call(store, 'get_request', { requestId: 'missing' });
    expect(bad.result).toBeNull();
    expect(bad.error).toMatch(/No request with id/);
  });

  it('update_request calls store.updateRequest with the given patch and returns the updated request', async () => {
    const store = makeStore();
    const id = store.collections[0].items[0].id;
    (store.updateRequest as ReturnType<typeof vi.fn>).mockImplementation((_reqId: string, patch: Partial<ApiRequest>) => {
      Object.assign(store.collections[0].items[0], patch);
    });
    const res = await call(store, 'update_request', { requestId: id, patch: { url: '/new-url' } });
    expect(store.updateRequest).toHaveBeenCalledWith(id, { url: '/new-url' });
    expect((res.result as ApiRequest).url).toBe('/new-url');
  });

  it('create_request adds a request under the given collection/folder', async () => {
    const store = makeStore();
    const res = await call(store, 'create_request', { collectionId: 'c1', request: { name: 'New', url: '/x' } });
    expect(store.addRequest).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'New', url: '/x' }), undefined);
    expect((res.result as ApiRequest).name).toBe('New');
  });

  it('create_request errors for an unknown collection, without calling addRequest', async () => {
    const store = makeStore();
    const res = await call(store, 'create_request', { collectionId: 'nope', request: {} });
    expect(res.error).toMatch(/No collection with id/);
    expect(store.addRequest).not.toHaveBeenCalled();
  });

  it('delete_request resolves the owning collection id and calls store.deleteItem', async () => {
    const store = makeStore();
    const id = store.collections[0].items[0].id;
    const res = await call(store, 'delete_request', { requestId: id });
    expect(store.deleteItem).toHaveBeenCalledWith('c1', id);
    expect(res.result).toEqual({ ok: true });
  });

  it('list_environments / get_environment / update_environment', async () => {
    const store = makeStore();
    const list = await call(store, 'list_environments', {});
    expect(list.result).toEqual([{ id: 'e1', name: 'Prod', collectionId: null }]);

    const got = await call(store, 'get_environment', { environmentId: 'e1' });
    expect(got.result).toMatchObject({ id: 'e1', name: 'Prod' });

    const patched = await call(store, 'update_environment', { environmentId: 'e1', patch: { name: 'Renamed' } });
    expect(store.updateEnvironment).toHaveBeenCalledWith('e1', { name: 'Renamed' });
    expect(patched.result).toEqual({ ok: true });

    const missing = await call(store, 'get_environment', { environmentId: 'nope' });
    expect(missing.error).toMatch(/No environment with id/);
  });

  it('set_active_environment routes to global vs. collection scope', async () => {
    const store = makeStore();
    await call(store, 'set_active_environment', { scope: 'global', environmentId: 'e1' });
    expect(store.setActiveGlobalEnv).toHaveBeenCalledWith('e1');

    await call(store, 'set_active_environment', { scope: 'collection', collectionId: 'c1', environmentId: null });
    expect(store.setActiveCollectionEnv).toHaveBeenCalledWith('c1', null);
  });

  it('set_node_script forwards to store.setNodeScript, defaulting nodeId to null for the collection root', async () => {
    const store = makeStore();
    const res = await call(store, 'set_node_script', { collectionId: 'c1', script: { req: 'a', res: 'b' } });
    expect(store.setNodeScript).toHaveBeenCalledWith('c1', null, { req: 'a', res: 'b' });
    expect(res.result).toEqual({ ok: true });
  });

  it('run_request calls runRequest with the resolved request and forwards its outcome', async () => {
    const store = makeStore();
    const id = store.collections[0].items[0].id;
    const runRequest = vi.fn().mockResolvedValue({
      response: { status: 200, statusText: 'OK', ok: true, headers: [], body: '{}', contentType: 'application/json', timeMs: 12, sizeBytes: 2 },
      tests: [], logs: [], error: null,
    });
    const res = await call(store, 'run_request', { requestId: id, environmentId: 'e1' }, runRequest);
    expect(runRequest).toHaveBeenCalledWith(expect.objectContaining({ id }), {}, undefined, 'e1');
    expect((res.result as { response: { status: number } }).response.status).toBe(200);
  });

  it('an unknown tool name reports an error instead of throwing', async () => {
    const res = await call(makeStore(), 'not_a_real_tool', {});
    expect(res.result).toBeNull();
    expect(res.error).toMatch(/Unknown MCP tool/);
  });

  it('unmount calls the Tauri unlisten function', async () => {
    const { unmount } = await renderBridge(makeStore(), vi.fn());
    await waitFor(() => expect(capturedCb).toBeDefined());
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
