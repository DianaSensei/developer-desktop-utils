import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileJson } from 'lucide-react';
import { definePlugin } from '@/platform/manifest';
import {
  PluginCommandError,
  PluginHostError,
  PluginPermissionError,
  createPluginSdk,
  storageKey,
} from '@/platform/sdk';
import * as audit from '@/platform/audit';
import { storageGet, storageRemove } from '@/lib/persistentStore';
import { clearSecrets, secretGet } from '@/platform/secrets';
import type { PluginManifest, PluginPermission } from '@/platform/types';

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(async () => {}),
  readTextFromClipboard: vi.fn(async () => 'từ clipboard'),
}));

function plugin(
  permissions: PluginPermission[],
  commands: string[] = [],
  hosts: string[] = ['*'],
): PluginManifest {
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
    hosts,
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

describe('secrets', () => {
  it('không khai quyền thì ném, và không ghi gì vào kho', async () => {
    const sdk = createPluginSdk(plugin([]));
    await expect(sdk.secrets.set('k', 'v')).rejects.toThrow(PluginPermissionError);
    await expect(sdk.secrets.get('k')).rejects.toThrow(PluginPermissionError);
    expect(await secretGet('demo', 'k')).toBeNull();
  });

  it('có quyền thì ghi/đọc được, và giá trị KHÔNG lọt vào nhật ký', async () => {
    const sdk = createPluginSdk(plugin(['secrets']));
    await sdk.secrets.set('accounts', 'JBSWY3DPEHPK3PXP');
    expect(await sdk.secrets.get('accounts')).toBe('JBSWY3DPEHPK3PXP');

    // Nhật ký chỉ được nêu TÊN khoá. Một audit log làm rò seed TOTP còn tệ
    // hơn là không có audit log.
    const entries = audit.recent().filter((e) => e.channel === 'secrets');
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(entries.some((e) => e.detail === 'accounts')).toBe(true);

    await clearSecrets();
  });
});

describe('env', () => {
  it('phơi ra thông tin môi trường mà không cần quyền nào', () => {
    const sdk = createPluginSdk(plugin([]));
    expect(typeof sdk.env.isTauri).toBe('boolean');
    expect(typeof sdk.env.isMac).toBe('boolean');
    expect(['⌘', 'Ctrl']).toContain(sdk.env.modKey);
  });
});

describe('files', () => {
  it('đọc và ghi là HAI quyền riêng — nhập file không kéo theo quyền ghi đè', async () => {
    const readOnly = createPluginSdk(plugin(['files:read']));
    await expect(readOnly.files.pickSave()).rejects.toThrow(PluginPermissionError);
    await expect(readOnly.files.writeText('/tmp/x', 'y')).rejects.toThrow(PluginPermissionError);

    const writeOnly = createPluginSdk(plugin(['files:write']));
    await expect(writeOnly.files.pickOpen()).rejects.toThrow(PluginPermissionError);
    await expect(writeOnly.files.readText('/tmp/x')).rejects.toThrow(PluginPermissionError);
  });

  it('nhật ký chỉ ghi TÊN file, không ghi đường dẫn chứa tên tài khoản', async () => {
    const sdk = createPluginSdk(plugin(['files:read']));
    // jsdom không có plugin-fs thật; điều cần khẳng định là audit đã ghi TRƯỚC
    // khi lời gọi thật diễn ra, và ghi đúng thứ.
    await sdk.files.readText('/Users/nguoi-dung-that/Documents/bi-mat.json').catch(() => {});

    const entry = audit.recent().find((e) => e.channel === 'files')!;
    expect(entry.detail).toBe('bi-mat.json');
    expect(JSON.stringify(entry)).not.toContain('nguoi-dung-that');
  });
});

describe('openExternal', () => {
  it('cần quyền "open-url" riêng, không dùng ké quyền http', async () => {
    await expect(createPluginSdk(plugin(['http'])).openExternal('https://x.com')).rejects.toThrow(
      PluginPermissionError,
    );

    const sdk = createPluginSdk(plugin(['open-url']));
    await sdk.openExternal('https://example.com/duong-dan?token=abc').catch(() => {});
    const entry = audit.recent().find((e) => e.channel === 'shell')!;
    expect(entry.allowed).toBe(true);
    expect(entry.detail).toBe('https://example.com');
    expect(JSON.stringify(entry)).not.toContain('abc');
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

  it('host ngoài allowlist bị chặn dù đã có quyền http — quyền mạng không phải quyền gọi mọi nơi', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const sdk = createPluginSdk(plugin(['http'], [], ['dns.google']));

    await expect(sdk.http.fetch('https://evil.example.com/x')).rejects.toThrow(PluginHostError);
    expect(spy).not.toHaveBeenCalled();

    await expect(sdk.http.fetch('https://dns.google/resolve')).resolves.toBeDefined();
    expect(spy).toHaveBeenCalledOnce();
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

  it('channel cũng cần quyền "native", và mở luồng được ghi lại kèm nhãn', async () => {
    await expect(createPluginSdk(plugin([])).native.channel(() => {})).rejects.toThrow(
      PluginPermissionError,
    );

    const sdk = createPluginSdk(plugin(['native'], ['redis_']));
    // jsdom không có `__TAURI_INTERNALS__` nên dựng Channel sẽ hỏng; điều cần
    // khẳng định là nó KHÔNG hỏng ở tầng quyền.
    await sdk.native.channel(() => {}, 'redis-pubsub').catch(() => {});

    const entry = audit.recent().find((e) => e.action === 'channel:redis-pubsub')!;
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
