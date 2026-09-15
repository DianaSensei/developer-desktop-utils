import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/**
 * `consumerStore` sits above `createRabbitApi` (its `consumeStart` call is the
 * only seam it needs — `types.test.ts` already covers how that maps to the
 * sidecar's `consume-start`/`consume-stop` JSONL methods), so these tests mock
 * `createRabbitApi` directly and assert the store's own bookkeeping: session
 * lifecycle, the message batching window, and the "stopped before start
 * resolved" race.
 */

const consumeStartMock = vi.fn();

vi.mock('@/platform', () => ({ getPluginSdk: () => ({}) }));
vi.mock('./types', () => ({ createRabbitApi: () => ({ consumeStart: consumeStartMock }) }));

async function loadStore() {
  vi.resetModules();
  return import('./consumerStore');
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const msg = (payload: string) => ({
  payload, exchange: '', routingKey: 'rk', redelivered: false, deliveryTag: 1,
  correlationId: null, contentType: null, messageId: null, headers: {},
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('consumerStore.start/stop', () => {
  it('registers a starting session immediately, marks it live once consumeStart resolves, and stop() tears it down', async () => {
    const { consumerStore } = await loadStore();

    const stop = vi.fn().mockResolvedValue(undefined);
    const d = deferred<{ stop: typeof stop }>();
    consumeStartMock.mockReturnValueOnce(d.promise);

    const startPromise = consumerStore.start('conn1', 'q1', 'consume', 10);
    expect(consumeStartMock).toHaveBeenCalledWith(
      { configId: 'conn1', queue: 'q1', ackMode: 'consume', prefetch: 10, reply: null },
      expect.any(Function),
    );

    d.resolve({ stop });
    await startPromise;

    await consumerStore.stop('conn1', 'q1');
    expect(stop).toHaveBeenCalled();
  });

  it('a second start() for the same connId/queue while already running is a no-op', async () => {
    const { consumerStore } = await loadStore();
    consumeStartMock.mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });

    await consumerStore.start('conn1', 'q1', 'consume', 10);
    await consumerStore.start('conn1', 'q1', 'consume', 10);
    expect(consumeStartMock).toHaveBeenCalledTimes(1);
  });

  it('stop() called before consumeStart resolves still tears the subscription down once it arrives, instead of leaving it orphaned', async () => {
    const { consumerStore } = await loadStore();
    const stop = vi.fn().mockResolvedValue(undefined);
    const d = deferred<{ stop: typeof stop }>();
    consumeStartMock.mockReturnValueOnce(d.promise);

    const startPromise = consumerStore.start('conn1', 'q1', 'consume', 10);
    await consumerStore.stop('conn1', 'q1'); // session already gone by the time consumeStart resolves
    d.resolve({ stop });
    await startPromise;

    expect(stop).toHaveBeenCalled();
  });

  it('a failed consumeStart discards the session and rejects start()', async () => {
    const { consumerStore, useQueueConsumer } = await loadStore();
    consumeStartMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(consumerStore.start('conn1', 'q1', 'consume', 10)).rejects.toThrow('connection refused');

    const { result } = renderHook(() => useQueueConsumer('conn1', 'q1'));
    expect(result.current).toBeUndefined();
  });

  it('forwards deliveries from consumeStart to onMessage into the session (batched via the flush timer)', async () => {
    vi.useFakeTimers();
    try {
      const { consumerStore, useQueueConsumer } = await loadStore();
      let onMessage!: (m: ReturnType<typeof msg>) => void;
      consumeStartMock.mockImplementationOnce((_args: unknown, cb: (m: ReturnType<typeof msg>) => void) => {
        onMessage = cb;
        return Promise.resolve({ stop: vi.fn().mockResolvedValue(undefined) });
      });

      await consumerStore.start('conn1', 'q1', 'consume', 10);
      onMessage(msg('hello'));

      const { result, rerender } = renderHook(() => useQueueConsumer('conn1', 'q1'));
      expect(result.current?.received).toBe(0); // not flushed yet

      await act(async () => { await vi.advanceTimersByTimeAsync(150); }); // FLUSH_MS = 120ms
      rerender();

      expect(result.current?.received).toBe(1);
      expect(result.current?.messages[0]).toMatchObject({ payload: 'hello' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopAll stops every registered subscription', async () => {
    const { consumerStore } = await loadStore();
    const stopA = vi.fn().mockResolvedValue(undefined);
    const stopB = vi.fn().mockResolvedValue(undefined);
    consumeStartMock
      .mockResolvedValueOnce({ stop: stopA })
      .mockResolvedValueOnce({ stop: stopB });

    await consumerStore.start('conn1', 'q1', 'consume', 10);
    await consumerStore.start('conn1', 'q2', 'consume', 10);
    await consumerStore.stopAll();

    expect(stopA).toHaveBeenCalled();
    expect(stopB).toHaveBeenCalled();
  });

  it('stopForConn only stops subscriptions belonging to that connection', async () => {
    const { consumerStore } = await loadStore();
    const stopA = vi.fn().mockResolvedValue(undefined);
    const stopB = vi.fn().mockResolvedValue(undefined);
    consumeStartMock
      .mockResolvedValueOnce({ stop: stopA })
      .mockResolvedValueOnce({ stop: stopB });

    await consumerStore.start('conn1', 'q1', 'consume', 10);
    await consumerStore.start('conn2', 'q1', 'consume', 10);
    await consumerStore.stopForConn('conn1');

    expect(stopA).toHaveBeenCalled();
    expect(stopB).not.toHaveBeenCalled();
  });
});
