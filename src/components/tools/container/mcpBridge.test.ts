import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ContainerToolState } from './useContainerState';
import type { ContainerConnection, LogLine, StatsFrame } from './types';

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
const listMock = vi.fn();
const detailsMock = vi.fn();
const startMock = vi.fn();
const stopMock = vi.fn();
const restartMock = vi.fn();
const pauseMock = vi.fn();
const unpauseMock = vi.fn();
const removeMock = vi.fn();
const logsStartMock = vi.fn();
const logsStopMock = vi.fn();
const statsSnapshotMock = vi.fn();
const imageListMock = vi.fn();
const imageDetailsMock = vi.fn();
const imageRemoveMock = vi.fn();

class FakeChannel<T> {
  onmessage: ((payload: T) => void) | null = null;
}

vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: FakeChannel,
}));
vi.mock('./types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./types')>();
  return {
    ...actual,
    containerApi: {
      listConfigs: (...a: unknown[]) => listConfigsMock(...a),
      saveConfig: (...a: unknown[]) => saveConfigMock(...a),
      deleteConfig: (...a: unknown[]) => deleteConfigMock(...a),
      testConnection: (...a: unknown[]) => testConnectionMock(...a),
      list: (...a: unknown[]) => listMock(...a),
      details: (...a: unknown[]) => detailsMock(...a),
      start: (...a: unknown[]) => startMock(...a),
      stop: (...a: unknown[]) => stopMock(...a),
      restart: (...a: unknown[]) => restartMock(...a),
      pause: (...a: unknown[]) => pauseMock(...a),
      unpause: (...a: unknown[]) => unpauseMock(...a),
      remove: (...a: unknown[]) => removeMock(...a),
      logsStart: (...a: unknown[]) => logsStartMock(...a),
      logsStop: (...a: unknown[]) => logsStopMock(...a),
      statsSnapshot: (...a: unknown[]) => statsSnapshotMock(...a),
      imageList: (...a: unknown[]) => imageListMock(...a),
      imageDetails: (...a: unknown[]) => imageDetailsMock(...a),
      imageRemove: (...a: unknown[]) => imageRemoveMock(...a),
    },
  };
});

type CallHandler = (event: { payload: { id: string; tool: string; args: Record<string, unknown> } }) => void;

async function renderBridge(state: ContainerToolState) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useMcpBridge } = await import('./mcpBridge');
  return renderHook(() => useMcpBridge(state));
}

function makeConn(overrides: Partial<ContainerConnection> = {}): ContainerConnection {
  return { id: 'c1', name: 'Local', socketPath: '/var/run/docker.sock', ...overrides };
}

function makeState(overrides: Partial<ContainerToolState> = {}): ContainerToolState {
  return {
    selectedConnId: '', setSelectedConnId: vi.fn(),
    connectedConnId: '', setConnectedConnId: vi.fn(),
    view: 'overview',
    showOverview: vi.fn(), showContainers: vi.fn(), showImages: vi.fn(),
    showVolumes: vi.fn(), showNetworks: vi.fn(), showCompose: vi.fn(),
    refreshKey: 0, refresh: vi.fn(),
    ...overrides,
  } as ContainerToolState;
}

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset().mockResolvedValue(undefined);
  listConfigsMock.mockReset().mockResolvedValue([makeConn()]);
  saveConfigMock.mockReset().mockImplementation((c: ContainerConnection) => Promise.resolve({ ...c, id: c.id || 'new-conn-id' }));
  deleteConfigMock.mockReset().mockResolvedValue(undefined);
  testConnectionMock.mockReset().mockResolvedValue(undefined);
  listMock.mockReset().mockResolvedValue([]);
  detailsMock.mockReset().mockResolvedValue({ id: 'ctr1', name: 'web', running: true });
  startMock.mockReset().mockResolvedValue(undefined);
  stopMock.mockReset().mockResolvedValue(undefined);
  restartMock.mockReset().mockResolvedValue(undefined);
  pauseMock.mockReset().mockResolvedValue(undefined);
  unpauseMock.mockReset().mockResolvedValue(undefined);
  removeMock.mockReset().mockResolvedValue(undefined);
  logsStartMock.mockReset().mockResolvedValue('stream-1');
  logsStopMock.mockReset().mockResolvedValue(undefined);
  statsSnapshotMock.mockReset().mockResolvedValue({});
  imageListMock.mockReset().mockResolvedValue([]);
  imageDetailsMock.mockReset().mockResolvedValue({ id: 'img1' });
  imageRemoveMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('useMcpBridge (Container) — web build (no __TAURI_INTERNALS__)', () => {
  it('never registers a listener outside Tauri', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useMcpBridge } = await import('./mcpBridge');
    renderHook(() => useMcpBridge(makeState()));
    await new Promise((r) => setTimeout(r, 0));
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('useMcpBridge (Container) — Tauri desktop', () => {
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

  async function call(state: ContainerToolState, tool: string, args: Record<string, unknown>) {
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

  // ── Connections ────────────────────────────────────────────────────────

  it('container_list_connections returns whatever containerApi.listConfigs resolves', async () => {
    const res = await call(makeState(), 'container_list_connections', {});
    expect(res.error).toBeNull();
    expect(res.result).toEqual([makeConn()]);
  });

  it('container_get_connection finds by id and errors on an unknown one', async () => {
    const ok = await call(makeState(), 'container_get_connection', { connectionId: 'c1' });
    expect((ok.result as ContainerConnection).id).toBe('c1');

    const bad = await call(makeState(), 'container_get_connection', { connectionId: 'nope' });
    expect(bad.result).toBeNull();
    expect(bad.error).toMatch(/No container connection with id/);
  });

  it('container_add_connection requires name and socketPath, saves with an empty id', async () => {
    const res = await call(makeState(), 'container_add_connection', { name: 'Colima', socketPath: '/tmp/colima.sock' });
    expect(saveConfigMock).toHaveBeenCalledWith({ id: '', name: 'Colima', socketPath: '/tmp/colima.sock' });
    expect((res.result as ContainerConnection).id).toBe('new-conn-id');
  });

  it('container_update_connection merges patch onto the existing connection (flat merge)', async () => {
    await call(makeState(), 'container_update_connection', { connectionId: 'c1', patch: { socketPath: '/tmp/other.sock' } });
    expect(saveConfigMock).toHaveBeenCalledWith(makeConn({ socketPath: '/tmp/other.sock' }));
  });

  it('container_delete_connection deletes an existing id and errors on an unknown one', async () => {
    const res = await call(makeState(), 'container_delete_connection', { connectionId: 'c1' });
    expect(deleteConfigMock).toHaveBeenCalledWith('c1');
    expect(res.result).toEqual({ ok: true });

    deleteConfigMock.mockClear();
    const bad = await call(makeState(), 'container_delete_connection', { connectionId: 'nope' });
    expect(bad.error).toMatch(/No container connection with id/);
    expect(deleteConfigMock).not.toHaveBeenCalled();
  });

  it('container_test_connection tests without touching connected state', async () => {
    const state = makeState();
    const res = await call(state, 'container_test_connection', { connectionId: 'c1' });
    expect(testConnectionMock).toHaveBeenCalledWith(makeConn());
    expect(state.setConnectedConnId).not.toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true });
  });

  it('container_connect tests and marks the connection live/selected', async () => {
    const state = makeState();
    const res = await call(state, 'container_connect', { connectionId: 'c1' });
    expect(testConnectionMock).toHaveBeenCalledWith(makeConn());
    expect(state.setConnectedConnId).toHaveBeenCalledWith('c1');
    expect(state.setSelectedConnId).toHaveBeenCalledWith('c1');
    expect(res.result).toEqual({ ok: true, connectedConnId: 'c1' });
  });

  it('container_disconnect clears the connected connection', async () => {
    const state = makeState({ connectedConnId: 'c1' });
    const res = await call(state, 'container_disconnect', {});
    expect(state.setConnectedConnId).toHaveBeenCalledWith('');
    expect(res.result).toEqual({ ok: true });
  });

  it('container_connection_status reports the current selection/connection', async () => {
    const state = makeState({ selectedConnId: 'c1', connectedConnId: 'c1' });
    const res = await call(state, 'container_connection_status', {});
    expect(res.result).toEqual({ selectedConnId: 'c1', connectedConnId: 'c1' });
  });

  // ── Lifecycle (require an active connection) ──────────────────────────

  it('container_list errors when no connection is active', async () => {
    const res = await call(makeState({ connectedConnId: '' }), 'container_list', {});
    expect(res.error).toMatch(/No active container connection/);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('container_list resolves the active connection and forwards `all`', async () => {
    listMock.mockResolvedValue([{ Id: 'ctr1' }]);
    const res = await call(makeState({ connectedConnId: 'c1' }), 'container_list', { all: true });
    expect(listMock).toHaveBeenCalledWith(makeConn(), true);
    expect(res.result).toEqual([{ Id: 'ctr1' }]);
  });

  it('container_inspect returns curated details', async () => {
    const res = await call(makeState({ connectedConnId: 'c1' }), 'container_inspect', { containerId: 'ctr1' });
    expect(detailsMock).toHaveBeenCalledWith(makeConn(), 'ctr1');
    expect(res.result).toEqual({ id: 'ctr1', name: 'web', running: true });
  });

  it('container_start/stop/restart/pause/unpause forward to the matching containerApi call', async () => {
    const state = makeState({ connectedConnId: 'c1' });
    await call(state, 'container_start', { containerId: 'ctr1' });
    expect(startMock).toHaveBeenCalledWith(makeConn(), 'ctr1');
    await call(state, 'container_stop', { containerId: 'ctr1' });
    expect(stopMock).toHaveBeenCalledWith(makeConn(), 'ctr1');
    await call(state, 'container_restart', { containerId: 'ctr1' });
    expect(restartMock).toHaveBeenCalledWith(makeConn(), 'ctr1');
    await call(state, 'container_pause', { containerId: 'ctr1' });
    expect(pauseMock).toHaveBeenCalledWith(makeConn(), 'ctr1');
    await call(state, 'container_unpause', { containerId: 'ctr1' });
    expect(unpauseMock).toHaveBeenCalledWith(makeConn(), 'ctr1');
  });

  it('container_remove forwards force', async () => {
    await call(makeState({ connectedConnId: 'c1' }), 'container_remove', { containerId: 'ctr1', force: true });
    expect(removeMock).toHaveBeenCalledWith(makeConn(), 'ctr1', true);
  });

  it('container_stats returns the snapshot for the requested container, errors if absent', async () => {
    const frame: StatsFrame = { cpuPercent: 1.5, memUsageBytes: 100, memLimitBytes: 1000, netRxBytes: 0, netTxBytes: 0 };
    statsSnapshotMock.mockResolvedValue({ ctr1: frame });
    const ok = await call(makeState({ connectedConnId: 'c1' }), 'container_stats', { containerId: 'ctr1' });
    expect(statsSnapshotMock).toHaveBeenCalledWith(makeConn(), ['ctr1']);
    expect(ok.result).toEqual(frame);

    statsSnapshotMock.mockResolvedValue({});
    const bad = await call(makeState({ connectedConnId: 'c1' }), 'container_stats', { containerId: 'ctr1' });
    expect(bad.error).toMatch(/No stats available/);
  });

  it('container_logs collects lines streamed through the Channel within the window, then stops the stream', async () => {
    let capturedChannel: FakeChannel<LogLine> | undefined;
    logsStartMock.mockImplementation((_config, _id, _tail, _since, _until, _ts, channel: FakeChannel<LogLine>) => {
      capturedChannel = channel;
      return Promise.resolve('stream-1');
    });

    await renderBridge(makeState({ connectedConnId: 'c1' }));
    await waitFor(() => expect(capturedCb).toBeDefined());
    const id = `call-${++callSeq}`;
    invokeMock.mockClear();
    capturedCb!({ payload: { id, tool: 'container_logs', args: { containerId: 'ctr1' } } });

    // Give logsStart's promise a tick to resolve and hand back the Channel
    // before feeding it messages — the real 1.5s collection window then
    // elapses for real (COLLECT_WINDOW_MS isn't exported to fake-time it).
    await new Promise((r) => setTimeout(r, 10));
    capturedChannel?.onmessage?.({ stream: 'stdout', message: 'hello' });
    capturedChannel?.onmessage?.({ stream: 'stdout', message: 'world' });

    await waitFor(
      () => expect(invokeMock).toHaveBeenCalledWith('mcp_respond', expect.objectContaining({ id })),
      { timeout: 3000 },
    );
    const res = invokeMock.mock.calls.find((c) => c[0] === 'mcp_respond' && (c[1] as { id: string }).id === id)?.[1] as { result: unknown };

    expect(logsStartMock).toHaveBeenCalledWith(makeConn(), 'ctr1', '100', 0, 0, false, expect.anything());
    expect(logsStopMock).toHaveBeenCalledWith('stream-1');
    expect(res.result).toEqual({ lines: [{ stream: 'stdout', message: 'hello' }, { stream: 'stdout', message: 'world' }] });
  }, 10000);

  // ── Images ─────────────────────────────────────────────────────────────

  it('container_list_images/container_image_details/container_remove_image forward to the active connection', async () => {
    const state = makeState({ connectedConnId: 'c1' });
    imageListMock.mockResolvedValue([{ Id: 'img1' }]);
    const list = await call(state, 'container_list_images', {});
    expect(imageListMock).toHaveBeenCalledWith(makeConn());
    expect(list.result).toEqual([{ Id: 'img1' }]);

    const details = await call(state, 'container_image_details', { imageId: 'img1' });
    expect(imageDetailsMock).toHaveBeenCalledWith(makeConn(), 'img1');
    expect(details.result).toEqual({ id: 'img1' });

    const removed = await call(state, 'container_remove_image', { imageId: 'img1', force: true });
    expect(imageRemoveMock).toHaveBeenCalledWith(makeConn(), 'img1', true);
    expect(removed.result).toEqual({ ok: true });
  });
});
