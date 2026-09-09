import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { RedisState } from './useRedisState';
import type { RedisConnection } from './types';

/**
 * `isTauri` is computed once at module load from `'__TAURI_INTERNALS__' in
 * window`, so — same gotcha as apiclient/mcpBridge.test.ts — it must be set
 * BEFORE importing `mcpBridge.ts`, with `vi.resetModules()` forcing a fresh
 * load, or the bridge's effect no-ops in plain jsdom.
 */

const listenMock = vi.fn();
const invokeMock = vi.fn();
const unlisten = vi.fn();
const listConfigsMock = vi.fn();
const saveConfigMock = vi.fn();
const deleteConfigMock = vi.fn();
const testConnectionMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('./types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./types')>();
  return {
    ...actual,
    redisApi: {
      listConfigs: (...a: unknown[]) => listConfigsMock(...a),
      saveConfig: (...a: unknown[]) => saveConfigMock(...a),
      deleteConfig: (...a: unknown[]) => deleteConfigMock(...a),
      testConnection: (...a: unknown[]) => testConnectionMock(...a),
    },
  };
});

type CallHandler = (event: { payload: { id: string; tool: string; args: Record<string, unknown> } }) => void;

async function renderBridge(state: RedisState) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useMcpBridge } = await import('./mcpBridge');
  return renderHook(() => useMcpBridge(state));
}

function makeConn(overrides: Partial<RedisConnection> = {}): RedisConnection {
  return { id: 'c1', name: 'Local', host: 'localhost', port: 6379, username: null, password: null, useTls: false, ...overrides };
}

function makeState(overrides: Partial<RedisState> = {}): RedisState {
  return {
    selectedConnId: '', setSelectedConnId: vi.fn(),
    connectedConnId: '', setConnectedConnId: vi.fn(),
    db: 0, setDb: vi.fn(),
    view: 'overview', selectedKey: null,
    showOverview: vi.fn(), showKeys: vi.fn(), showCli: vi.fn(), showPubSub: vi.fn(), showAdmin: vi.fn(), selectKey: vi.fn(),
    refreshKey: 0, refresh: vi.fn(),
    ...overrides,
  } as RedisState;
}

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset().mockResolvedValue(undefined);
  listConfigsMock.mockReset().mockResolvedValue([makeConn()]);
  saveConfigMock.mockReset().mockImplementation((c: RedisConnection) => Promise.resolve({ ...c, id: c.id || 'new-conn-id' }));
  deleteConfigMock.mockReset().mockResolvedValue(undefined);
  testConnectionMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('useMcpBridge (Redis) — web build (no __TAURI_INTERNALS__)', () => {
  it('never registers a listener outside Tauri', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useMcpBridge } = await import('./mcpBridge');
    renderHook(() => useMcpBridge(makeState()));
    await new Promise((r) => setTimeout(r, 0));
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('useMcpBridge (Redis) — Tauri desktop', () => {
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

  async function call(state: RedisState, tool: string, args: Record<string, unknown>) {
    await renderBridge(state);
    await waitFor(() => expect(capturedCb).toBeDefined());
    const id = `call-${++callSeq}`;
    invokeMock.mockClear();
    capturedCb!({ payload: { id, tool, args } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('mcp_respond', expect.objectContaining({ id })));
    return invokeMock.mock.calls.find((c) => c[0] === 'mcp_respond' && (c[1] as { id: string }).id === id)?.[1] as { id: string; result: unknown; error: unknown };
  }

  it('registers exactly one mcp:call listener', async () => {
    await renderBridge(makeState());
    await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    expect(listenMock.mock.calls[0][0]).toBe('mcp:call');
  });

  it('an mcp:call for a tool this bridge does not own is left unanswered', async () => {
    await renderBridge(makeState());
    await waitFor(() => expect(capturedCb).toBeDefined());
    invokeMock.mockClear();
    capturedCb!({ payload: { id: 'other-tool-call', tool: 'list_collections', args: {} } });
    await new Promise((r) => setTimeout(r, 0));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('redis_list_connections returns whatever redisApi.listConfigs resolves, unmasked', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ password: 'secret' })]);
    const res = await call(makeState(), 'redis_list_connections', {});
    expect(res.error).toBeNull();
    expect(res.result).toEqual([makeConn({ password: 'secret' })]);
  });

  it('redis_get_connection finds by id and errors on an unknown one', async () => {
    const ok = await call(makeState(), 'redis_get_connection', { connectionId: 'c1' });
    expect((ok.result as RedisConnection).id).toBe('c1');

    const bad = await call(makeState(), 'redis_get_connection', { connectionId: 'nope' });
    expect(bad.result).toBeNull();
    expect(bad.error).toMatch(/No Redis connection with id/);
  });

  it('redis_add_connection defaults port/useTls and saves with an empty id', async () => {
    const res = await call(makeState(), 'redis_add_connection', { name: 'Staging', host: 'staging.local' });
    expect(saveConfigMock).toHaveBeenCalledWith({
      id: '', name: 'Staging', host: 'staging.local', port: 6379, username: null, password: null, useTls: false,
    });
    expect((res.result as RedisConnection).id).toBe('new-conn-id');
  });

  it('redis_update_connection merges patch onto the existing connection (flat merge)', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ port: 6379, useTls: false })]);
    await call(makeState(), 'redis_update_connection', { connectionId: 'c1', patch: { useTls: true } });
    expect(saveConfigMock).toHaveBeenCalledWith(makeConn({ port: 6379, useTls: true }));
  });

  it('redis_delete_connection deletes an existing id and errors on an unknown one without deleting', async () => {
    const res = await call(makeState(), 'redis_delete_connection', { connectionId: 'c1' });
    expect(deleteConfigMock).toHaveBeenCalledWith('c1');
    expect(res.result).toEqual({ ok: true });

    deleteConfigMock.mockClear();
    const bad = await call(makeState(), 'redis_delete_connection', { connectionId: 'nope' });
    expect(bad.error).toMatch(/No Redis connection with id/);
    expect(deleteConfigMock).not.toHaveBeenCalled();
  });

  it('redis_test_connection resolves the full config and calls redisApi.testConnection, without touching connected state', async () => {
    const state = makeState();
    const res = await call(state, 'redis_test_connection', { connectionId: 'c1' });
    expect(testConnectionMock).toHaveBeenCalledWith(makeConn());
    expect(state.setConnectedConnId).not.toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true });
  });

  it('redis_connect tests, marks the connection live/selected, and optionally sets db', async () => {
    const state = makeState();
    const res = await call(state, 'redis_connect', { connectionId: 'c1', db: 3 });
    expect(testConnectionMock).toHaveBeenCalledWith(makeConn());
    expect(state.setConnectedConnId).toHaveBeenCalledWith('c1');
    expect(state.setSelectedConnId).toHaveBeenCalledWith('c1');
    expect(state.setDb).toHaveBeenCalledWith(3);
    expect(res.result).toEqual({ ok: true, connectedConnId: 'c1', db: 3 });
  });

  it('redis_connect does not call setDb when db is omitted', async () => {
    const state = makeState();
    await call(state, 'redis_connect', { connectionId: 'c1' });
    expect(state.setDb).not.toHaveBeenCalled();
  });

  it('redis_disconnect clears the connected connection', async () => {
    const state = makeState({ connectedConnId: 'c1' });
    const res = await call(state, 'redis_disconnect', {});
    expect(state.setConnectedConnId).toHaveBeenCalledWith('');
    expect(res.result).toEqual({ ok: true });
  });

  it('redis_connection_status reports the current selection/connection/db', async () => {
    const state = makeState({ selectedConnId: 'c1', connectedConnId: 'c1', db: 2 });
    const res = await call(state, 'redis_connection_status', {});
    expect(res.result).toEqual({ selectedConnId: 'c1', connectedConnId: 'c1', db: 2 });
  });
});
