import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileJson } from 'lucide-react';
import { definePlugin, validateManifest } from '@/platform/manifest';
import {
  PluginServiceError,
  SERVICE_PROTOCOL,
  createPluginService,
  type ServiceRequest,
  type ServiceSubscription,
  type ServiceTransport,
} from '@/platform/service';
import * as audit from '@/platform/audit';
import type { PluginManifest } from '@/platform/types';

function plugin(extra: Partial<PluginManifest> = {}): PluginManifest {
  return definePlugin({
    id: 'demo',
    label: 'Demo',
    icon: FileJson,
    description: 'Plugin giả lập dùng cho test.',
    route: '/demo',
    order: 10,
    defaultEnabled: true,
    sdk: '^1.0.0',
    load: async () => () => null,
    ...extra,
  });
}

const withService = () =>
  plugin({
    permissions: ['service'],
    service: { bin: 'devtool-svc-demo', methods: ['ping', 'echo'] },
  });

function fakeTransport(
  reply: (req: ServiceRequest) => { result?: unknown; error?: string; protocol?: number },
): ServiceTransport & { calls: ServiceRequest[] } {
  const calls: ServiceRequest[] = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      const r = reply(request);
      return { protocol: r.protocol ?? SERVICE_PROTOCOL, id: request.id, result: r.result, error: r.error };
    },
  };
}

beforeEach(() => audit.clear());

describe('manifest — service descriptor', () => {
  it('quyền "service" và descriptor phải đi cùng nhau', () => {
    expect(validateManifest(withService())).toEqual([]);
    expect(validateManifest(plugin({ permissions: ['service'] })).join()).toMatch(/không khai service descriptor/);
    expect(
      validateManifest(plugin({ service: { bin: 'devtool-svc-demo', methods: ['ping'] } })).join(),
    ).toMatch(/thiếu quyền "service"/);
  });

  it('methods rỗng bị từ chối — sidecar không giới hạn method là quyền mở vô hạn', () => {
    expect(
      validateManifest(plugin({ permissions: ['service'], service: { bin: 'devtool-svc-demo', methods: [] } })).join(),
    ).toMatch(/quyền mở vô hạn/);
  });

  it('bin phải là tên binary trần, không đuôi và không target-triple', () => {
    for (const bin of ['devtool-svc-demo.exe', 'devtool-svc-demo-x86_64-unknown-linux-gnu', '../evil', 'Demo']) {
      expect(
        validateManifest(plugin({ permissions: ['service'], service: { bin, methods: ['ping'] } })).join(),
        bin,
      ).toMatch(/service\.bin/);
    }
  });
});

describe('sdk.service.call', () => {
  it('gửi đúng khung tin nhắn, kèm protocol và danh tính plugin', async () => {
    const transport = fakeTransport(() => ({ result: 'pong' }));
    const service = createPluginService(withService(), transport);

    await expect(service.call('ping', { n: 1 })).resolves.toBe('pong');
    expect(transport.calls[0]).toMatchObject({
      protocol: SERVICE_PROTOCOL,
      plugin: 'demo',
      bin: 'devtool-svc-demo',
      method: 'ping',
      params: { n: 1 },
    });
    expect(transport.calls[0].id).toContain('demo');
  });

  it('không khai service thì chặn ngay, không chạm tới transport', async () => {
    const transport = fakeTransport(() => ({ result: 'pong' }));
    const service = createPluginService(plugin(), transport);

    await expect(service.call('ping')).rejects.toThrow(PluginServiceError);
    expect(transport.calls).toHaveLength(0);
  });

  it('method ngoài danh sách bị chặn ở client, không tới được tiến trình con', async () => {
    const transport = fakeTransport(() => ({ result: 'ok' }));
    const service = createPluginService(withService(), transport);

    await expect(service.call('rm-rf')).rejects.toThrow(/ngoài danh sách methods/);
    expect(transport.calls).toHaveLength(0);
  });

  it('lệch protocol thì từ chối thay vì diễn giải payload của phiên bản khác', async () => {
    const service = createPluginService(withService(), fakeTransport(() => ({ result: 'x', protocol: 99 })));
    await expect(service.call('ping')).rejects.toThrow(/lệch protocol/);
  });

  it('lỗi từ host nổi lên thành PluginServiceError, giữ nguyên nội dung', async () => {
    const service = createPluginService(withService(), fakeTransport(() => ({ error: 'sidecar chết' })));
    await expect(service.call('ping')).rejects.toThrow(/sidecar chết/);
  });

  it('mọi lời gọi đều để lại audit, kể cả lời gọi bị chặn', async () => {
    const service = createPluginService(withService(), fakeTransport(() => ({ result: 'ok' })));
    await service.call('ping');
    await expect(service.call('rm-rf')).rejects.toThrow();

    const entries = audit.recent().filter((e) => e.channel === 'service');
    expect(entries.map((e) => [e.action, e.allowed])).toEqual([
      ['rm-rf', false],
      ['ping', true],
    ]);
  });

  it('transport mặc định chỉ được nạp khi thực sự gọi — không kéo Tauri vào bundle test', async () => {
    const spy = vi.fn();
    const service = createPluginService(withService(), { send: spy.mockResolvedValue({ protocol: SERVICE_PROTOCOL, id: 'x', result: 1 }) });
    await service.call('ping');
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('sdk.service.stream', () => {
  function fakeStreamingTransport(
    emit: (request: ServiceRequest, onMessage: (event: unknown) => void) => void,
  ): ServiceTransport & { calls: ServiceRequest[]; stopped: ServiceRequest[] } {
    const calls: ServiceRequest[] = [];
    const stopped: ServiceRequest[] = [];
    return {
      calls,
      stopped,
      async send(request) {
        calls.push(request);
        return { protocol: SERVICE_PROTOCOL, id: request.id, result: null };
      },
      async stream(request, onMessage) {
        calls.push(request);
        emit(request, onMessage);
        return {
          async stop() {
            stopped.push(request);
          },
        };
      },
    };
  }

  it('dùng chung cửa chặn với call: method ngoài danh sách bị từ chối, không chạm transport', async () => {
    const transport = fakeStreamingTransport(() => {});
    const service = createPluginService(withService(), transport);

    await expect(service.stream('rm-rf', vi.fn())).rejects.toThrow(/ngoài danh sách methods/);
    expect(transport.calls).toHaveLength(0);
  });

  it('không khai service thì chặn ngay, không chạm transport', async () => {
    const transport = fakeStreamingTransport(() => {});
    const service = createPluginService(plugin(), transport);

    await expect(service.stream('ping', vi.fn())).rejects.toThrow(PluginServiceError);
    expect(transport.calls).toHaveLength(0);
  });

  it('transport không cài .stream thì báo lỗi rõ ràng thay vì gọi nhầm sang send', async () => {
    const transport: ServiceTransport = {
      async send(request) {
        return { protocol: SERVICE_PROTOCOL, id: request.id, result: 'không nên tới đây' };
      },
    };
    const service = createPluginService(withService(), transport);

    await expect(service.stream('ping', vi.fn())).rejects.toThrow(/không hỗ trợ stream/);
  });

  it('sự kiện tới đúng onMessage, và .stop() gọi lại đúng request đã đăng ký', async () => {
    let capturedStop: (() => Promise<void>) | undefined;
    const transport = fakeStreamingTransport((_request, onMessage) => {
      onMessage(0);
      onMessage(1);
    });
    const service = createPluginService(withService(), transport);

    const events: unknown[] = [];
    const subscription: ServiceSubscription = await service.stream('ping', (event) => events.push(event));
    capturedStop = subscription.stop.bind(subscription);
    expect(events).toEqual([0, 1]);

    await capturedStop();
    expect(transport.stopped).toHaveLength(1);
    expect(transport.stopped[0]).toMatchObject({ plugin: 'demo', bin: 'devtool-svc-demo', method: 'ping' });
  });

  it('mỗi lời gọi stream đều ghi audit như call, kể cả khi bị chặn', async () => {
    const transport = fakeStreamingTransport(() => {});
    const service = createPluginService(withService(), transport);

    await expect(service.stream('rm-rf', vi.fn())).rejects.toThrow();

    const entries = audit.recent().filter((e) => e.channel === 'service');
    expect(entries.map((e) => [e.action, e.allowed])).toEqual([['rm-rf', false]]);
  });
});
