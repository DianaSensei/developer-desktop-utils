import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { KafkaState } from './useKafkaState';
import type { BrokerConfig } from './types';

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
const stopForBrokerMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('./types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./types')>();
  return {
    ...actual,
    kafkaApi: {
      listConfigs: (...a: unknown[]) => listConfigsMock(...a),
      saveConfig: (...a: unknown[]) => saveConfigMock(...a),
      deleteConfig: (...a: unknown[]) => deleteConfigMock(...a),
      testConnection: (...a: unknown[]) => testConnectionMock(...a),
    },
  };
});
vi.mock('./kafkaConsumerStore', () => ({
  kafkaConsumerStore: { stopForBroker: (...a: unknown[]) => stopForBrokerMock(...a) },
}));

type CallHandler = (event: { payload: { id: string; tool: string; args: Record<string, unknown> } }) => void;

async function renderBridge(state: KafkaState) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useMcpBridge } = await import('./mcpBridge');
  return renderHook(() => useMcpBridge(state));
}

function makeConn(overrides: Partial<BrokerConfig> = {}): BrokerConfig {
  return { id: 'b1', name: 'Local', bootstrapServers: 'localhost:9092', sslEnabled: false, ...overrides };
}

function makeState(overrides: Partial<KafkaState> = {}): KafkaState {
  return {
    selectedBrokerId: '', setSelectedBrokerId: vi.fn(),
    connectedBrokerId: '', setConnectedBrokerId: vi.fn(),
    view: 'topics', selectedTopic: null, selectedGroup: null,
    selectedTab: 'data', setSelectedTab: vi.fn(),
    consumePrefill: null, producePrefill: null, consumeDetailTopic: null,
    showTopics: vi.fn(), showGroups: vi.fn(), showConsumers: vi.fn(), openConsumer: vi.fn(), showProduce: vi.fn(),
    selectTopic: vi.fn(), selectGroup: vi.fn(),
    refreshKey: 0, refresh: vi.fn(),
    ...overrides,
  } as KafkaState;
}

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset().mockResolvedValue(undefined);
  listConfigsMock.mockReset().mockResolvedValue([makeConn()]);
  saveConfigMock.mockReset().mockImplementation((c: BrokerConfig) => Promise.resolve({ ...c, id: c.id || 'new-conn-id' }));
  deleteConfigMock.mockReset().mockResolvedValue(undefined);
  testConnectionMock.mockReset().mockResolvedValue(undefined);
  stopForBrokerMock.mockReset();
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('useMcpBridge (Kafka) — web build (no __TAURI_INTERNALS__)', () => {
  it('never registers a listener outside Tauri', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useMcpBridge } = await import('./mcpBridge');
    renderHook(() => useMcpBridge(makeState()));
    await new Promise((r) => setTimeout(r, 0));
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('useMcpBridge (Kafka) — Tauri desktop', () => {
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

  async function call(state: KafkaState, tool: string, args: Record<string, unknown>) {
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

  it('kafka_list_connections returns whatever kafkaApi.listConfigs resolves, unmasked', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ saslPassword: 'secret' })]);
    const res = await call(makeState(), 'kafka_list_connections', {});
    expect(res.error).toBeNull();
    expect(res.result).toEqual([makeConn({ saslPassword: 'secret' })]);
  });

  it('kafka_get_connection finds by id and errors on an unknown one', async () => {
    const ok = await call(makeState(), 'kafka_get_connection', { connectionId: 'b1' });
    expect((ok.result as BrokerConfig).id).toBe('b1');

    const bad = await call(makeState(), 'kafka_get_connection', { connectionId: 'nope' });
    expect(bad.result).toBeNull();
    expect(bad.error).toMatch(/No Kafka connection with id/);
  });

  it('kafka_add_connection defaults sslEnabled and saves with an empty id', async () => {
    const res = await call(makeState(), 'kafka_add_connection', { name: 'Staging', bootstrapServers: 'staging:9092' });
    expect(saveConfigMock).toHaveBeenCalledWith({
      id: '', name: 'Staging', bootstrapServers: 'staging:9092',
      saslMechanism: undefined, saslUsername: undefined, saslPassword: undefined, sslEnabled: false,
    });
    expect((res.result as BrokerConfig).id).toBe('new-conn-id');
  });

  it('kafka_update_connection merges patch onto the existing connection (flat merge)', async () => {
    listConfigsMock.mockResolvedValue([makeConn({ sslEnabled: false })]);
    await call(makeState(), 'kafka_update_connection', { connectionId: 'b1', patch: { sslEnabled: true } });
    expect(saveConfigMock).toHaveBeenCalledWith(makeConn({ sslEnabled: true }));
  });

  it('kafka_delete_connection deletes an existing id and errors on an unknown one without deleting', async () => {
    const res = await call(makeState(), 'kafka_delete_connection', { connectionId: 'b1' });
    expect(deleteConfigMock).toHaveBeenCalledWith('b1');
    expect(res.result).toEqual({ ok: true });

    deleteConfigMock.mockClear();
    const bad = await call(makeState(), 'kafka_delete_connection', { connectionId: 'nope' });
    expect(bad.error).toMatch(/No Kafka connection with id/);
    expect(deleteConfigMock).not.toHaveBeenCalled();
  });

  it('kafka_test_connection calls kafkaApi.testConnection by id, without touching connected state', async () => {
    const state = makeState();
    const res = await call(state, 'kafka_test_connection', { connectionId: 'b1' });
    expect(testConnectionMock).toHaveBeenCalledWith('b1');
    expect(state.setConnectedBrokerId).not.toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true });
  });

  it('kafka_connect tests and marks the broker live/selected, stopping consumers on the previous broker', async () => {
    const state = makeState({ connectedBrokerId: 'old-broker' });
    const res = await call(state, 'kafka_connect', { connectionId: 'b1' });
    expect(testConnectionMock).toHaveBeenCalledWith('b1');
    expect(stopForBrokerMock).toHaveBeenCalledWith('old-broker');
    expect(state.setConnectedBrokerId).toHaveBeenCalledWith('b1');
    expect(state.setSelectedBrokerId).toHaveBeenCalledWith('b1');
    expect(res.result).toEqual({ ok: true, connectedBrokerId: 'b1' });
  });

  it('kafka_connect does not stop consumers when reconnecting to the already-connected broker', async () => {
    const state = makeState({ connectedBrokerId: 'b1' });
    await call(state, 'kafka_connect', { connectionId: 'b1' });
    expect(stopForBrokerMock).not.toHaveBeenCalled();
  });

  it('kafka_disconnect stops consumers on the connected broker and clears it', async () => {
    const state = makeState({ connectedBrokerId: 'b1' });
    const res = await call(state, 'kafka_disconnect', {});
    expect(stopForBrokerMock).toHaveBeenCalledWith('b1');
    expect(state.setConnectedBrokerId).toHaveBeenCalledWith('');
    expect(res.result).toEqual({ ok: true });
  });

  it('kafka_disconnect is a no-op on stopForBroker when nothing is connected', async () => {
    const state = makeState({ connectedBrokerId: '' });
    await call(state, 'kafka_disconnect', {});
    expect(stopForBrokerMock).not.toHaveBeenCalled();
    expect(state.setConnectedBrokerId).toHaveBeenCalledWith('');
  });

  it('kafka_connection_status reports the current selection/connection', async () => {
    const state = makeState({ selectedBrokerId: 'b1', connectedBrokerId: 'b1' });
    const res = await call(state, 'kafka_connection_status', {});
    expect(res.result).toEqual({ selectedBrokerId: 'b1', connectedBrokerId: 'b1' });
  });
});
