import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { RabbitState } from './useRabbitState';
import type { RabbitConnection } from './types';

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
const amqpTestMock = vi.fn();
const mgmtTestConnectionMock = vi.fn();
const stopForConnMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('./types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./types')>();
  return {
    ...actual,
    rabbitApi: {
      listConfigs: (...a: unknown[]) => listConfigsMock(...a),
      saveConfig: (...a: unknown[]) => saveConfigMock(...a),
      deleteConfig: (...a: unknown[]) => deleteConfigMock(...a),
      amqpTest: (...a: unknown[]) => amqpTestMock(...a),
    },
  };
});
vi.mock('./api', () => ({
  rabbitMgmt: { testConnection: (...a: unknown[]) => mgmtTestConnectionMock(...a) },
}));
vi.mock('./consumerStore', () => ({
  consumerStore: { stopForConn: (...a: unknown[]) => stopForConnMock(...a) },
}));

type CallHandler = (event: { payload: { id: string; tool: string; args: Record<string, unknown> } }) => void;

async function renderBridge(state: RabbitState) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useMcpBridge } = await import('./mcpBridge');
  return renderHook(() => useMcpBridge(state));
}

function makeConn(overrides: Partial<RabbitConnection> = {}): RabbitConnection {
  return {
    id: 'c1', name: 'Local', host: 'localhost', port: 15672, vhost: '/',
    username: 'guest', password: 'guest', useTls: false, amqpPort: 5672, amqpOnly: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<RabbitState> = {}): RabbitState {
  return {
    selectedConnId: '', setSelectedConnId: vi.fn(),
    connectedConnId: '', setConnectedConnId: vi.fn(),
    view: 'overview', selectedQueue: null, selectedExchange: null,
    rpcPrefill: null, consumerPrefill: null, consumeDetailQueue: null,
    showOverview: vi.fn(), showConnections: vi.fn(), showRpc: vi.fn(), showConsumers: vi.fn(),
    openConsumer: vi.fn(), showQueues: vi.fn(), showExchanges: vi.fn(),
    selectQueue: vi.fn(), selectExchange: vi.fn(),
    refreshKey: 0, refresh: vi.fn(),
    ...overrides,
  } as RabbitState;
}

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset().mockResolvedValue(undefined);
  listConfigsMock.mockReset().mockResolvedValue([makeConn()]);
  saveConfigMock.mockReset().mockImplementation((c: RabbitConnection) => Promise.resolve({ ...c, id: c.id || 'new-conn-id' }));
  deleteConfigMock.mockReset().mockResolvedValue(undefined);
  amqpTestMock.mockReset().mockResolvedValue(undefined);
  mgmtTestConnectionMock.mockReset().mockResolvedValue(undefined);
  stopForConnMock.mockReset();
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('useMcpBridge (RabbitMQ) — web build (no __TAURI_INTERNALS__)', () => {
  it('never registers a listener outside Tauri', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useMcpBridge } = await import('./mcpBridge');
    renderHook(() => useMcpBridge(makeState()));
    await new Promise((r) => setTimeout(r, 0));
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('useMcpBridge (RabbitMQ) — Tauri desktop', () => {
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

  async function call(state: RabbitState, tool: string, args: Record<string, unknown>) {
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
    capturedCb!({ payload: { id: 'other-tool-call', tool: 'mock_status', args: {} } });
    await new Promise((r) => setTimeout(r, 0));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rabbit_list_connections returns whatever rabbitApi.listConfigs resolves, unmasked', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ password: 'secret' })]);
    const res = await call(makeState(), 'rabbit_list_connections', {});
    expect(res.error).toBeNull();
    expect(res.result).toEqual([makeConn({ password: 'secret' })]);
  });

  it('rabbit_get_connection finds by id and errors on an unknown one', async () => {
    const ok = await call(makeState(), 'rabbit_get_connection', { connectionId: 'c1' });
    expect((ok.result as RabbitConnection).id).toBe('c1');

    const bad = await call(makeState(), 'rabbit_get_connection', { connectionId: 'nope' });
    expect(bad.result).toBeNull();
    expect(bad.error).toMatch(/No RabbitMQ connection with id/);
  });

  it('rabbit_add_connection defaults port/vhost/credentials/amqpPort/amqpOnly and saves with an empty id', async () => {
    const res = await call(makeState(), 'rabbit_add_connection', { name: 'Staging', host: 'staging.local' });
    expect(saveConfigMock).toHaveBeenCalledWith({
      id: '', name: 'Staging', host: 'staging.local', port: 15672, vhost: '/',
      username: 'guest', password: 'guest', useTls: false, amqpPort: 5672, amqpOnly: true,
    });
    expect((res.result as RabbitConnection).id).toBe('new-conn-id');
  });

  it('rabbit_update_connection merges patch onto the existing connection (flat merge)', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ useTls: false })]);
    await call(makeState(), 'rabbit_update_connection', { connectionId: 'c1', patch: { useTls: true } });
    expect(saveConfigMock).toHaveBeenCalledWith(makeConn({ useTls: true }));
  });

  it('rabbit_delete_connection deletes an existing id and errors on an unknown one without deleting', async () => {
    const res = await call(makeState(), 'rabbit_delete_connection', { connectionId: 'c1' });
    expect(deleteConfigMock).toHaveBeenCalledWith('c1');
    expect(res.result).toEqual({ ok: true });

    deleteConfigMock.mockClear();
    const bad = await call(makeState(), 'rabbit_delete_connection', { connectionId: 'nope' });
    expect(bad.error).toMatch(/No RabbitMQ connection with id/);
    expect(deleteConfigMock).not.toHaveBeenCalled();
  });

  it('rabbit_test_connection runs only the AMQP test for an amqpOnly profile, without touching connected state', async () => {
    const state = makeState();
    const res = await call(state, 'rabbit_test_connection', { connectionId: 'c1' });
    expect(amqpTestMock).toHaveBeenCalledWith(makeConn());
    expect(mgmtTestConnectionMock).not.toHaveBeenCalled();
    expect(state.setConnectedConnId).not.toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true });
  });

  it('rabbit_test_connection also runs the management API test when amqpOnly is false', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ amqpOnly: false })]);
    await call(makeState(), 'rabbit_test_connection', { connectionId: 'c1' });
    expect(amqpTestMock).toHaveBeenCalledWith(makeConn({ amqpOnly: false }));
    expect(mgmtTestConnectionMock).toHaveBeenCalledWith(makeConn({ amqpOnly: false }));
  });

  it('rabbit_connect tests and marks the connection live/selected, stopping consumers on the previous connection', async () => {
    const state = makeState({ connectedConnId: 'old-conn' });
    const res = await call(state, 'rabbit_connect', { connectionId: 'c1' });
    expect(amqpTestMock).toHaveBeenCalledWith(makeConn());
    expect(stopForConnMock).toHaveBeenCalledWith('old-conn');
    expect(state.setConnectedConnId).toHaveBeenCalledWith('c1');
    expect(state.setSelectedConnId).toHaveBeenCalledWith('c1');
    expect(res.result).toEqual({ ok: true, connectedConnId: 'c1' });
  });

  it('rabbit_connect does not stop consumers when reconnecting to the already-connected connection', async () => {
    const state = makeState({ connectedConnId: 'c1' });
    await call(state, 'rabbit_connect', { connectionId: 'c1' });
    expect(stopForConnMock).not.toHaveBeenCalled();
  });

  it('rabbit_disconnect stops consumers on the connected connection and clears it', async () => {
    const state = makeState({ connectedConnId: 'c1' });
    const res = await call(state, 'rabbit_disconnect', {});
    expect(stopForConnMock).toHaveBeenCalledWith('c1');
    expect(state.setConnectedConnId).toHaveBeenCalledWith('');
    expect(res.result).toEqual({ ok: true });
  });

  it('rabbit_disconnect is a no-op on stopForConn when nothing is connected', async () => {
    const state = makeState({ connectedConnId: '' });
    await call(state, 'rabbit_disconnect', {});
    expect(stopForConnMock).not.toHaveBeenCalled();
    expect(state.setConnectedConnId).toHaveBeenCalledWith('');
  });

  it('rabbit_connection_status reports the current selection/connection', async () => {
    const state = makeState({ selectedConnId: 'c1', connectedConnId: 'c1' });
    const res = await call(state, 'rabbit_connection_status', {});
    expect(res.result).toEqual({ selectedConnId: 'c1', connectedConnId: 'c1' });
  });
});
