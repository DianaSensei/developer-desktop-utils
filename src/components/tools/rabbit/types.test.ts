import { describe, expect, it, vi } from 'vitest';
import type { PluginSdk } from '@/platform';
import { createRabbitApi, type ConsumedMessage, type PublishArgs, type RpcCallArgs } from './types';

/**
 * `createRabbitApi` is the ONE seam every RabbitMQ view/hook/store goes
 * through to talk to the sidecar (`devtool-svc-rabbit`) — see the "điểm
 * thắt" note in `docs/decisions/platform-plugin-architecture.md`. These
 * tests mock `sdk.service.call`/`sdk.service.stream` directly (the
 * platform's own `service.test.ts` already covers permission-checking/audit
 * inside those), so they only need to assert this file maps each RabbitApi
 * method to the right kebab-case JSONL method name and params shape.
 */

function makeSdk(overrides: { call?: ReturnType<typeof vi.fn>; stream?: ReturnType<typeof vi.fn> } = {}) {
  const call = overrides.call ?? vi.fn().mockResolvedValue(undefined);
  const stream = overrides.stream ?? vi.fn().mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
  const sdk = { service: { call, stream } } as unknown as PluginSdk;
  return { sdk, call, stream };
}

const conn = {
  id: 'c1',
  name: 'Local',
  host: 'localhost',
  port: 15672,
  vhost: '/',
  username: 'guest',
  password: 'guest',
  useTls: false,
  amqpPort: 5672,
  amqpOnly: true,
};

describe('createRabbitApi — one-shot methods map to the sidecar kebab-case method names', () => {
  it('listConfigs / saveConfig / deleteConfig / amqpTest', async () => {
    const { sdk, call } = makeSdk();
    const api = createRabbitApi(sdk);

    await api.listConfigs();
    expect(call).toHaveBeenCalledWith('list-configs', undefined);

    await api.saveConfig(conn);
    expect(call).toHaveBeenCalledWith('save-config', { config: conn });

    await api.deleteConfig('c1');
    expect(call).toHaveBeenCalledWith('delete-config', { configId: 'c1' });

    await api.amqpTest(conn);
    expect(call).toHaveBeenCalledWith('amqp-test', { config: conn });
  });

  it('publish', async () => {
    const { sdk, call } = makeSdk();
    const api = createRabbitApi(sdk);
    const args: PublishArgs = {
      configId: 'c1',
      exchange: 'ex',
      routingKey: 'rk',
      payload: 'hello',
      properties: {},
      mandatory: false,
      confirm: true,
    };

    await api.publish(args);
    expect(call).toHaveBeenCalledWith('publish', {
      configId: 'c1',
      exchange: 'ex',
      routingKey: 'rk',
      payload: 'hello',
      properties: {},
      mandatory: false,
      confirm: true,
    });
  });

  it('rpcCall fills optional fields with null defaults', async () => {
    const { sdk, call } = makeSdk();
    const api = createRabbitApi(sdk);
    const args: RpcCallArgs = {
      configId: 'c1',
      exchange: 'ex',
      routingKey: 'rk',
      payload: 'ping',
      timeoutMs: 5000,
    };

    await api.rpcCall(args);
    expect(call).toHaveBeenCalledWith('rpc-call', {
      configId: 'c1',
      exchange: 'ex',
      routingKey: 'rk',
      payload: 'ping',
      correlationId: null,
      contentType: null,
      headers: null,
      timeoutMs: 5000,
    });
  });

  it('AMQP-only topology methods', async () => {
    const { sdk, call } = makeSdk();
    const api = createRabbitApi(sdk);

    await api.amqpQueuesInfo('c1', ['q1']);
    expect(call).toHaveBeenCalledWith('amqp-queues-info', { configId: 'c1', names: ['q1'] });

    await api.amqpExchangesInfo('c1', ['ex1']);
    expect(call).toHaveBeenCalledWith('amqp-exchanges-info', { configId: 'c1', names: ['ex1'] });

    await api.amqpDeclareQueue('c1', 'q1', true, false);
    expect(call).toHaveBeenCalledWith('amqp-declare-queue', { configId: 'c1', name: 'q1', durable: true, autoDelete: false });

    await api.amqpDeclareExchange('c1', 'ex1', 'topic', true, false, false);
    expect(call).toHaveBeenCalledWith('amqp-declare-exchange', {
      configId: 'c1', name: 'ex1', kind: 'topic', durable: true, autoDelete: false, internal: false,
    });

    await api.amqpBindQueue('c1', 'q1', 'ex1', 'rk');
    expect(call).toHaveBeenCalledWith('amqp-bind-queue', { configId: 'c1', queue: 'q1', exchange: 'ex1', routingKey: 'rk' });
  });
});

describe('createRabbitApi — consumeStart', () => {
  /**
   * `consumeStart` waits for the sidecar's first real event ("subscribed" or
   * "error") before resolving/rejecting — it does NOT resolve as soon as
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
      onMessage({ type: 'subscribed', subscriptionId: 'consumer-1' });
      return Promise.resolve({ stop: hostStop });
    });
    return { stream, hostStop, emit: (event: unknown) => emit!(event) };
  }

  it('opens the stream method with configId/queue/ackMode/prefetch/reply and resolves once "subscribed" arrives', async () => {
    const { stream } = streamThatEmitsSubscribed();
    const { sdk } = makeSdk({ stream });
    const api = createRabbitApi(sdk);

    const sub = await api.consumeStart({ configId: 'c1', queue: 'q1', ackMode: 'consume', prefetch: 10 }, () => {});

    expect(stream).toHaveBeenCalledWith('consume-start', expect.any(Function), {
      configId: 'c1',
      queue: 'q1',
      ackMode: 'consume',
      prefetch: 10,
      reply: null,
    });
    expect(sub.stop).toBeInstanceOf(Function);
  });

  it('forwards "message" events to onMessage as a ConsumedMessage, does not forward "subscribed"', async () => {
    const { stream, emit } = streamThatEmitsSubscribed();
    const { sdk } = makeSdk({ stream });
    const api = createRabbitApi(sdk);
    const onMessage = vi.fn();

    await api.consumeStart({ configId: 'c1', queue: 'q1', ackMode: 'peek', prefetch: 1 }, onMessage);
    expect(onMessage).not.toHaveBeenCalled();

    emit({
      type: 'message',
      payload: 'hi',
      exchange: 'ex',
      routingKey: 'rk',
      redelivered: false,
      deliveryTag: 1,
      correlationId: null,
      contentType: null,
      messageId: null,
      headers: {},
    });
    const expected: ConsumedMessage = {
      payload: 'hi', exchange: 'ex', routingKey: 'rk', redelivered: false, deliveryTag: 1,
      correlationId: null, contentType: null, messageId: null, headers: {},
    };
    expect(onMessage).toHaveBeenCalledWith(expected);
  });

  it('rejects when the sidecar sends a stream "error" event instead of "subscribed", and cleans up the host-side stream', async () => {
    const hostStop = vi.fn().mockResolvedValue(undefined);
    const stream = vi.fn().mockImplementation((_method, onMessage) => {
      onMessage({ type: 'error', message: 'Consume failed: queue not found' });
      return Promise.resolve({ stop: hostStop });
    });
    const { sdk } = makeSdk({ stream });
    const api = createRabbitApi(sdk);

    await expect(
      api.consumeStart({ configId: 'c1', queue: 'missing', ackMode: 'consume', prefetch: 1 }, () => {}),
    ).rejects.toThrow('Consume failed: queue not found');
    // Đăng ký host đã lỡ mở (stream() ở trên trả về thành công) — phải được
    // dọn ngay, không để lại một stream mồ côi không ai còn đọc.
    expect(hostStop).toHaveBeenCalled();
  });

  it('stop() calls consume-stop with the captured subscriptionId BEFORE stopping the host-side stream', async () => {
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
    const api = createRabbitApi(sdk);

    const sub = await api.consumeStart({ configId: 'c1', queue: 'q1', ackMode: 'consume', prefetch: 1 }, () => {});
    await sub.stop();

    expect(call).toHaveBeenCalledWith('consume-stop', { consumerId: 'consumer-1' });
    expect(order).toEqual(['call:consume-stop', 'hostStop']);
  });

  it('stop() still stops the host-side stream even if the sidecar consume-stop call rejects', async () => {
    const call = vi.fn().mockRejectedValue(new Error('sidecar gone'));
    const hostStop = vi.fn().mockResolvedValue(undefined);
    const { stream } = streamThatEmitsSubscribed(hostStop);
    const { sdk } = makeSdk({ call, stream });
    const api = createRabbitApi(sdk);

    const sub = await api.consumeStart({ configId: 'c1', queue: 'q1', ackMode: 'consume', prefetch: 1 }, () => {});

    await expect(sub.stop()).resolves.toBeUndefined();
    expect(hostStop).toHaveBeenCalled();
  });
});
