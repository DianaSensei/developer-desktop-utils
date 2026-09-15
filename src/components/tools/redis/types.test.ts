import { describe, expect, it, vi } from 'vitest';
import type { PluginSdk } from '@/platform';
import { createRedisApi } from './types';

/**
 * `createRedisApi` is the ONE seam every Redis view/hook goes through to talk
 * to the sidecar (`devtool-svc-redis`) — see the "điểm thắt" note in
 * `docs/decisions/platform-plugin-architecture.md`. These tests mock
 * `sdk.service.call`/`sdk.service.stream` directly (the platform's own
 * `service.test.ts` already covers permission-checking/audit inside those),
 * so they only need to assert this file maps each RedisApi method to the
 * right kebab-case JSONL method name and params shape.
 */

function makeSdk(overrides: { call?: ReturnType<typeof vi.fn>; stream?: ReturnType<typeof vi.fn> } = {}) {
  const call = overrides.call ?? vi.fn().mockResolvedValue(undefined);
  const stream = overrides.stream ?? vi.fn().mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
  const sdk = { service: { call, stream } } as unknown as PluginSdk;
  return { sdk, call, stream };
}

describe('createRedisApi — one-shot methods map to the sidecar kebab-case method names', () => {
  it('listConfigs / saveConfig / deleteConfig / testConnection', async () => {
    const { sdk, call } = makeSdk();
    const api = createRedisApi(sdk);
    const conn = { id: 'c1', name: 'Local', host: 'localhost', port: 6379, useTls: false };

    await api.listConfigs();
    expect(call).toHaveBeenCalledWith('list-configs', undefined);

    await api.saveConfig(conn);
    expect(call).toHaveBeenCalledWith('save-config', { config: conn });

    await api.deleteConfig('c1');
    expect(call).toHaveBeenCalledWith('delete-config', { configId: 'c1' });

    await api.testConnection(conn);
    expect(call).toHaveBeenCalledWith('test-connection', { config: conn });
  });

  it('key browsing methods', async () => {
    const { sdk, call } = makeSdk();
    const api = createRedisApi(sdk);

    await api.overview('c1', 0);
    expect(call).toHaveBeenCalledWith('overview', { configId: 'c1', db: 0 });

    await api.scanKeys('c1', 0, 0, '*', 100);
    expect(call).toHaveBeenCalledWith('scan-keys', { configId: 'c1', db: 0, cursor: 0, pattern: '*', count: 100 });

    await api.keySummary('c1', 0, ['a', 'b']);
    expect(call).toHaveBeenCalledWith('key-summary', { configId: 'c1', db: 0, keys: ['a', 'b'] });

    await api.getKey('c1', 0, 'a');
    expect(call).toHaveBeenCalledWith('get-key', { configId: 'c1', db: 0, key: 'a' });

    await api.memoryUsage('c1', 0, 'a');
    expect(call).toHaveBeenCalledWith('memory-usage', { configId: 'c1', db: 0, key: 'a' });
  });

  it('key mutation methods', async () => {
    const { sdk, call } = makeSdk();
    const api = createRedisApi(sdk);

    await api.setString('c1', 0, 'a', 'v', 60);
    expect(call).toHaveBeenCalledWith('set-string', { configId: 'c1', db: 0, key: 'a', value: 'v', ttlSeconds: 60 });

    await api.setTtl('c1', 0, 'a', null);
    expect(call).toHaveBeenCalledWith('set-ttl', { configId: 'c1', db: 0, key: 'a', ttlSeconds: null });

    await api.deleteKeys('c1', 0, ['a']);
    expect(call).toHaveBeenCalledWith('delete-keys', { configId: 'c1', db: 0, keys: ['a'] });

    await api.renameKey('c1', 0, 'a', 'b');
    expect(call).toHaveBeenCalledWith('rename-key', { configId: 'c1', db: 0, oldKey: 'a', newKey: 'b' });
  });

  it('CLI console + admin methods', async () => {
    const { sdk, call } = makeSdk();
    const api = createRedisApi(sdk);

    await api.exec('c1', 0, ['GET', 'a']);
    expect(call).toHaveBeenCalledWith('exec', { configId: 'c1', db: 0, args: ['GET', 'a'] });

    await api.clientList('c1');
    expect(call).toHaveBeenCalledWith('client-list', { configId: 'c1' });

    await api.slowlog('c1', 10);
    expect(call).toHaveBeenCalledWith('slowlog', { configId: 'c1', count: 10 });

    await api.configGet('c1', 'maxmemory*');
    expect(call).toHaveBeenCalledWith('config-get', { configId: 'c1', pattern: 'maxmemory*' });

    await api.configSet('c1', 'maxmemory', '100mb');
    expect(call).toHaveBeenCalledWith('config-set', { configId: 'c1', param: 'maxmemory', value: '100mb' });
  });

  it('publish', async () => {
    const { sdk, call } = makeSdk();
    const api = createRedisApi(sdk);
    await api.publish('c1', 'news', 'hello');
    expect(call).toHaveBeenCalledWith('publish', { configId: 'c1', channel: 'news', message: 'hello' });
  });
});

describe('createRedisApi — pubsubSubscribe', () => {
  /**
   * `pubsubSubscribe` waits for the sidecar's first real event ("subscribed"
   * or "error") before resolving/rejecting — it does NOT resolve as soon as
   * `sdk.service.stream()` itself returns. These mocks emit "subscribed"
   * synchronously inside the `stream()` mock implementation (before it
   * returns its own resolved promise) to model that: the real
   * `sdk.service.stream()` attaches `onMessage` to the Channel before ever
   * invoking the Tauri command, so an event CAN arrive before the outer
   * `stream()` promise settles.
   */
  function streamThatEmitsSubscribed(hostStop = vi.fn().mockResolvedValue(undefined)) {
    let emit: ((event: unknown) => void) | undefined;
    const stream = vi.fn().mockImplementation((_method, onMessage) => {
      emit = onMessage;
      onMessage({ type: 'subscribed', subscriptionId: 'sub-1' });
      return Promise.resolve({ stop: hostStop });
    });
    return { stream, hostStop, emit: (event: unknown) => emit!(event) };
  }

  it('opens the stream method with configId/channels/patterns and resolves once "subscribed" arrives', async () => {
    const { stream } = streamThatEmitsSubscribed();
    const { sdk } = makeSdk({ stream });
    const api = createRedisApi(sdk);

    const sub = await api.pubsubSubscribe('c1', ['news'], ['alerts.*'], () => {});

    expect(stream).toHaveBeenCalledWith('pubsub-subscribe', expect.any(Function), {
      configId: 'c1',
      channels: ['news'],
      patterns: ['alerts.*'],
    });
    expect(sub.stop).toBeInstanceOf(Function);
  });

  it('forwards "message" events to onMessage, does not forward "subscribed"', async () => {
    const { stream, emit } = streamThatEmitsSubscribed();
    const { sdk } = makeSdk({ stream });
    const api = createRedisApi(sdk);
    const onMessage = vi.fn();

    await api.pubsubSubscribe('c1', ['news'], [], onMessage);
    expect(onMessage).not.toHaveBeenCalled();

    emit({ type: 'message', channel: 'news', pattern: null, payload: 'hello' });
    expect(onMessage).toHaveBeenCalledWith({ channel: 'news', pattern: null, payload: 'hello' });
  });

  it('rejects when the sidecar sends a stream "error" event instead of "subscribed", and cleans up the host-side stream', async () => {
    const hostStop = vi.fn().mockResolvedValue(undefined);
    const stream = vi.fn().mockImplementation((_method, onMessage) => {
      onMessage({ type: 'error', message: 'Connection refused' });
      return Promise.resolve({ stop: hostStop });
    });
    const { sdk } = makeSdk({ stream });
    const api = createRedisApi(sdk);

    await expect(api.pubsubSubscribe('c1', ['news'], [], () => {})).rejects.toThrow('Connection refused');
    // Đăng ký host đã lỡ mở (stream() ở trên trả về thành công) — phải được
    // dọn ngay, không để lại một stream mồ côi không ai còn đọc.
    expect(hostStop).toHaveBeenCalled();
  });

  it('stop() calls unsubscribe with the captured subscriptionId BEFORE stopping the host-side stream', async () => {
    const order: string[] = [];
    const call = vi.fn().mockImplementation((method: string) => {
      order.push(`call:${method}`);
      return Promise.resolve(undefined);
    });
    const hostStop = vi.fn().mockImplementation(() => {
      order.push('hostStop');
      return Promise.resolve(undefined);
    });
    const { stream } = streamThatEmitsSubscribed(hostStop);
    const { sdk } = makeSdk({ call, stream });
    const api = createRedisApi(sdk);

    const sub = await api.pubsubSubscribe('c1', ['news'], [], () => {});
    await sub.stop();

    expect(call).toHaveBeenCalledWith('unsubscribe', { subscriptionId: 'sub-1' });
    expect(order).toEqual(['call:unsubscribe', 'hostStop']);
  });

  it('stop() still stops the host-side stream even if the sidecar unsubscribe call rejects', async () => {
    const call = vi.fn().mockRejectedValue(new Error('sidecar gone'));
    const hostStop = vi.fn().mockResolvedValue(undefined);
    const { stream } = streamThatEmitsSubscribed(hostStop);
    const { sdk } = makeSdk({ call, stream });
    const api = createRedisApi(sdk);

    const sub = await api.pubsubSubscribe('c1', ['news'], [], () => {});

    await expect(sub.stop()).resolves.toBeUndefined();
    expect(hostStop).toHaveBeenCalled();
  });
});
