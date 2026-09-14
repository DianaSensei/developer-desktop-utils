import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileJson } from 'lucide-react';
import { definePlugin } from '@/platform/manifest';
import { PluginCommandError, PluginPermissionError, createPluginSdk, storageKey } from '@/platform/sdk';
import * as audit from '@/platform/audit';
import { storageGet, storageRemove } from '@/lib/persistentStore';
import type { PluginManifest, PluginPermission } from '@/platform/types';

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(async () => {}),
  readTextFromClipboard: vi.fn(async () => 'từ clipboard'),
}));

function plugin(permissions: PluginPermission[], commands: string[] = []): PluginManifest {
  return definePlugin({
    id: 'demo',
    label: 'Demo',
    icon: FileJson,
    description: 'Plugin giả lập dùng cho test.',
    route: '/demo',
    order: 10,
    defaultEnabled: true,
    permissions,
    commands,
    sdk: '^1.0.0',
    load: async () => () => null,
  });
}

beforeEach(() => {
  audit.clear();
  storageRemove(storageKey('demo', 'k'));
});

describe('storage', () => {
  it('gắn namespace theo id plugin, giữ nguyên tiền tố `devtool:<id>:` các tool đang dùng', () => {
    // Đổi tiền tố này là im lặng vứt đi collection/lịch sử/cấu hình người dùng
    // đã lưu, nên nó được khoá bằng test chứ không chỉ bằng bình luận.
    expect(storageKey('api-client', 'collections')).toBe('devtool:api-client:collections');

    const sdk = createPluginSdk(plugin(['storage']));
    sdk.storage.set('k', 'v');
    expect(storageGet('devtool:demo:k')).toBe('v');
    expect(sdk.storage.get('k')).toBe('v');
    expect(sdk.storage.key('k')).toBe('devtool:demo:k');

    sdk.storage.remove('k');
    expect(sdk.storage.get('k')).toBeNull();
  });

  it('không khai quyền thì ném, và KHÔNG ghi gì ra store', () => {
    const sdk = createPluginSdk(plugin([]));
    expect(() => sdk.storage.set('k', 'v')).toThrow(PluginPermissionError);
    expect(storageGet('devtool:demo:k')).toBeNull();
  });
});

describe('clipboard / http', () => {
  it('đọc và ghi clipboard cần đúng quyền tương ứng, không phải một quyền chung', async () => {
    const readOnly = createPluginSdk(plugin(['clipboard:read']));
    await expect(readOnly.clipboard.readText()).resolves.toBe('từ clipboard');
    await expect(readOnly.clipboard.writeText('x')).rejects.toThrow(PluginPermissionError);

    const writeOnly = createPluginSdk(plugin(['clipboard:write']));
    await expect(writeOnly.clipboard.writeText('x')).resolves.toBeUndefined();
    await expect(writeOnly.clipboard.readText()).rejects.toThrow(PluginPermissionError);
  });

  it('http không khai quyền thì ném trước khi gửi bất kỳ request nào', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const sdk = createPluginSdk(plugin([]));
    await expect(sdk.http.fetch('https://example.com')).rejects.toThrow(PluginPermissionError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('http có quyền thì đi qua và chỉ ghi lại host, không ghi path/query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const sdk = createPluginSdk(plugin(['http']));
    await sdk.http.fetch('https://api.example.com/v1/secret?token=abc123');
    expect(spy).toHaveBeenCalled();

    const entry = audit.recent().find((e) => e.channel === 'http')!;
    expect(entry.allowed).toBe(true);
    expect(entry.detail).toBe('https://api.example.com');
    expect(JSON.stringify(entry)).not.toContain('abc123');
    spy.mockRestore();
  });
});

describe('native.invoke', () => {
  it('thiếu quyền "native" thì ném PluginPermissionError', async () => {
    const sdk = createPluginSdk(plugin([]));
    await expect(sdk.native.invoke('redis_get_key')).rejects.toThrow(PluginPermissionError);
  });

  it('có quyền nhưng lệnh ngoài allowlist thì vẫn ném — quyền native không phải quyền vô hạn', async () => {
    const sdk = createPluginSdk(plugin(['native'], ['redis_']));
    await expect(sdk.native.invoke('container_remove')).rejects.toThrow(PluginCommandError);
  });

  it('allowlist khớp theo tiền tố', async () => {
    const sdk = createPluginSdk(plugin(['native'], ['redis_']));
    // Không gọi được Tauri trong jsdom, nên chỉ cần xác nhận nó KHÔNG bị chặn
    // ở tầng quyền: lỗi thoát ra phải là lỗi nạp module, không phải lỗi quyền.
    await expect(sdk.native.invoke('redis_get_key')).rejects.not.toBeInstanceOf(PluginCommandError);
    const entry = audit.recent().find((e) => e.action === 'redis_get_key')!;
    expect(entry.allowed).toBe(true);
  });

  it('mỗi lời gọi chỉ sinh đúng một dòng audit', async () => {
    const sdk = createPluginSdk(plugin(['native'], ['redis_']));
    await expect(sdk.native.invoke('container_remove')).rejects.toThrow();
    expect(audit.recent().filter((e) => e.action === 'container_remove')).toHaveLength(1);
  });
});

describe('audit', () => {
  it('ghi cả lời gọi BỊ TỪ CHỐI, kèm quyền còn thiếu — đó là chỗ lỗi lặng lẽ lộ ra', () => {
    const sdk = createPluginSdk(plugin([]));
    expect(() => sdk.storage.get('k')).toThrow();

    const [entry] = audit.recent();
    expect(entry).toMatchObject({
      pluginId: 'demo',
      channel: 'storage',
      action: 'get',
      allowed: false,
      missingPermission: 'storage',
    });
  });

  it('lọc được theo plugin', () => {
    createPluginSdk(plugin(['storage'])).log('mở');
    expect(audit.recentFor('demo')).toHaveLength(1);
    expect(audit.recentFor('plugin-khac')).toHaveLength(0);
  });

  it('subscribe nhận bản ghi mới; listener ném lỗi không làm gãy lời gọi SDK', () => {
    const seen: string[] = [];
    const off = audit.subscribe((e) => seen.push(e.action));
    audit.subscribe(() => {
      throw new Error('listener hỏng');
    });

    const sdk = createPluginSdk(plugin(['storage']));
    expect(() => sdk.storage.set('k', 'v')).not.toThrow();
    expect(seen).toContain('set');
    off();
  });

  it('describeUrl chịu được URL rác thay vì ném giữa lúc đang ghi log', () => {
    expect(audit.describeUrl('https://api.example.com:8443/x?t=1')).toBe('https://api.example.com:8443');
    expect(audit.describeUrl('không-phải-url')).toBe('<url không hợp lệ>');
    expect(audit.describeUrl('/duong-dan-tuong-doi')).toBe('<url không hợp lệ>');
  });
});
