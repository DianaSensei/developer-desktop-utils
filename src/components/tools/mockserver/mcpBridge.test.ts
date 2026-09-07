import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MockServerState } from './useMockServer';
import { defaultConfig, newStub, type MockConfig, type RequestLogEntry, type Stub } from './types';

/**
 * `isTauri` is computed once at module load from `'__TAURI_INTERNALS__' in
 * window`, so — same gotcha as apiclient/mcpBridge.test.ts — it must be set
 * BEFORE importing `mcpBridge.ts`, with `vi.resetModules()` forcing a fresh
 * load, or the bridge's effect no-ops in plain jsdom.
 */

const listenMock = vi.fn();
const invokeMock = vi.fn();
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

type CallHandler = (event: { payload: { id: string; tool: string; args: Record<string, unknown> } }) => void;

async function renderBridge(state: MockServerState) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useMcpBridge } = await import('./mcpBridge');
  return renderHook(() => useMcpBridge(state));
}

function makeStub(overrides: Partial<Stub> = {}): Stub {
  return { ...newStub(), ...overrides };
}

function makeState(overrides: Partial<MockServerState> = {}): MockServerState {
  const config: MockConfig = { ...defaultConfig(), stubs: [makeStub({ id: 's1', name: 'Hello' })] };
  return {
    config,
    setConfig: vi.fn(),
    updateConfig: vi.fn(),
    updateStub: vi.fn(),
    addStub: vi.fn().mockReturnValue(makeStub({ id: 'new-stub-id' })),
    duplicateStub: vi.fn().mockReturnValue(makeStub({ id: 'dup-stub-id' })),
    deleteStub: vi.fn(),
    moveStub: vi.fn(),
    status: { running: false, host: '', port: 0 },
    log: [],
    error: null,
    busy: false,
    start: vi.fn().mockResolvedValue({ running: true, host: '127.0.0.1', port: 8787 }),
    stop: vi.fn().mockResolvedValue(undefined),
    testScript: vi.fn().mockResolvedValue({ ok: true, status: 200, headers: [], body: 'ok', error: null }),
    clearLog: vi.fn(),
    ...overrides,
  } as unknown as MockServerState;
}

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('useMcpBridge (Mock Server) — web build (no __TAURI_INTERNALS__)', () => {
  it('never registers a listener outside Tauri', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useMcpBridge } = await import('./mcpBridge');
    renderHook(() => useMcpBridge(makeState()));
    await new Promise((r) => setTimeout(r, 0));
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('useMcpBridge (Mock Server) — Tauri desktop', () => {
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

  async function call(state: MockServerState, tool: string, args: Record<string, unknown>) {
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

  it('mock_get_config returns bind/fallback/status plus a summarized stub list', async () => {
    const state = makeState({ status: { running: true, host: '127.0.0.1', port: 8787 } });
    const res = await call(state, 'mock_get_config', {});
    expect(res.error).toBeNull();
    expect(res.result).toEqual({
      host: state.config.host,
      port: state.config.port,
      notFoundStatus: state.config.notFoundStatus,
      notFoundBody: state.config.notFoundBody,
      notFoundContentType: state.config.notFoundContentType,
      running: true,
      url: 'http://127.0.0.1:8787',
      stubs: [{ id: 's1', enabled: true, name: 'Hello', method: 'GET', path: '/hello', mode: 'static', status: 200 }],
    });
  });

  it('mock_get_stub finds a stub and errors on an unknown id', async () => {
    const state = makeState();
    const ok = await call(state, 'mock_get_stub', { stubId: 's1' });
    expect(ok.error).toBeNull();
    expect((ok.result as Stub).name).toBe('Hello');

    const bad = await call(state, 'mock_get_stub', { stubId: 'missing' });
    expect(bad.result).toBeNull();
    expect(bad.error).toMatch(/No stub with id/);
  });

  it('mock_add_stub forwards the partial stub and returns the created one', async () => {
    const state = makeState();
    const res = await call(state, 'mock_add_stub', { stub: { name: 'New' } });
    expect(state.addStub).toHaveBeenCalledWith({ name: 'New' });
    expect((res.result as Stub).id).toBe('new-stub-id');
  });

  it('mock_update_stub patches an existing stub and errors on an unknown id', async () => {
    const state = makeState();
    const ok = await call(state, 'mock_update_stub', { stubId: 's1', patch: { name: 'Renamed' } });
    expect(state.updateStub).toHaveBeenCalledWith('s1', { name: 'Renamed' });
    expect(ok.result).toEqual({ ok: true });

    const bad = await call(state, 'mock_update_stub', { stubId: 'missing', patch: {} });
    expect(bad.error).toMatch(/No stub with id/);
    expect(state.updateStub).toHaveBeenCalledTimes(1);
  });

  it('mock_duplicate_stub forwards to state.duplicateStub and returns the copy', async () => {
    const state = makeState();
    const res = await call(state, 'mock_duplicate_stub', { stubId: 's1' });
    expect(state.duplicateStub).toHaveBeenCalledWith('s1');
    expect((res.result as Stub).id).toBe('dup-stub-id');
  });

  it('mock_delete_stub forwards to state.deleteStub and errors on an unknown id', async () => {
    const state = makeState();
    const ok = await call(state, 'mock_delete_stub', { stubId: 's1' });
    expect(state.deleteStub).toHaveBeenCalledWith('s1');
    expect(ok.result).toEqual({ ok: true });

    const bad = await call(state, 'mock_delete_stub', { stubId: 'missing' });
    expect(bad.error).toMatch(/No stub with id/);
  });

  it('mock_move_stub maps direction to ±1 and rejects an invalid direction', async () => {
    const state = makeState();
    await call(state, 'mock_move_stub', { stubId: 's1', direction: 'up' });
    expect(state.moveStub).toHaveBeenCalledWith('s1', -1);

    await call(state, 'mock_move_stub', { stubId: 's1', direction: 'down' });
    expect(state.moveStub).toHaveBeenCalledWith('s1', 1);

    const bad = await call(state, 'mock_move_stub', { stubId: 's1', direction: 'sideways' });
    expect(bad.error).toMatch(/"direction" must be "up" or "down"/);
  });

  it('mock_set_fallback and mock_set_bind forward through updateConfig', async () => {
    const state = makeState();
    await call(state, 'mock_set_fallback', { patch: { notFoundStatus: 418 } });
    expect(state.updateConfig).toHaveBeenCalledWith({ notFoundStatus: 418 });

    await call(state, 'mock_set_bind', { host: '0.0.0.0', port: 9000 });
    expect(state.updateConfig).toHaveBeenCalledWith({ host: '0.0.0.0', port: 9000 });
  });

  it('mock_start / mock_stop / mock_status', async () => {
    const state = makeState();
    const started = await call(state, 'mock_start', {});
    expect(state.start).toHaveBeenCalled();
    expect(started.result).toEqual({ running: true, host: '127.0.0.1', port: 8787 });

    const stopped = await call(state, 'mock_stop', {});
    expect(state.stop).toHaveBeenCalled();
    expect(stopped.result).toEqual({ ok: true });

    const status = await call(state, 'mock_status', {});
    expect(status.result).toEqual(state.status);
  });

  it('mock_test_script forwards script + sample, defaulting sample when omitted', async () => {
    const state = makeState();
    const res = await call(state, 'mock_test_script', { script: 'req.body' });
    expect(state.testScript).toHaveBeenCalledWith('req.body', { method: 'GET', path: '/', query: {}, headers: {}, params: {}, body: '' });
    expect(res.result).toEqual({ ok: true, status: 200, headers: [], body: 'ok', error: null });

    await call(state, 'mock_test_script', { script: 'req.body', sample: { method: 'POST', path: '/x' } });
    expect(state.testScript).toHaveBeenCalledWith('req.body', { method: 'POST', path: '/x' });
  });

  it('mock_get_request_log truncates oversized bodies and respects limit', async () => {
    const bigBody = 'x'.repeat(6_000);
    const entries: RequestLogEntry[] = [
      { id: 'r1', ts: 1, method: 'GET', path: '/a', query: '', status: 200, matchedStubId: 's1', durationMs: 1, reqHeaders: [], reqBody: bigBody, resBody: 'ok' },
      { id: 'r2', ts: 2, method: 'GET', path: '/b', query: '', status: 404, matchedStubId: null, durationMs: 1, reqHeaders: [], reqBody: '', resBody: '' },
    ];
    const state = makeState({ log: entries });
    const res = await call(state, 'mock_get_request_log', { limit: 1 });
    const rows = res.result as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('r1');
    expect((rows[0].reqBody as string)).toHaveLength(5_000);
    expect(rows[0].reqBodyTruncated).toBe(true);
    expect(rows[0].reqBodyFullLength).toBe(6_000);
    expect(rows[0].resBody).toBe('ok');
    expect(rows[0]).not.toHaveProperty('resBodyTruncated');
  });

  it('mock_clear_request_log forwards to state.clearLog', async () => {
    const state = makeState();
    const res = await call(state, 'mock_clear_request_log', {});
    expect(state.clearLog).toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true });
  });

  it('unmount calls the Tauri unlisten function', async () => {
    const { unmount } = await renderBridge(makeState());
    await waitFor(() => expect(capturedCb).toBeDefined());
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
