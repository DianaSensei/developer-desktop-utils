import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileJson } from 'lucide-react';
import type { PluginManifest } from './types';

/**
 * `initInstalledPlugins()` nối plugin cài từ bên ngoài vào ĐÚNG mảng
 * `records` mà các plugin compile-time đã nằm sẵn — tách file riêng khỏi
 * `registry.test.ts` (giữ bộ pin plugin ở đó không bị xáo trộn bởi việc mock
 * `./installer` ở đây) vì registry.ts là SINGLETON theo module: gọi
 * `initInstalledPlugins()` hai lần trong cùng một lần nạp module sẽ cộng dồn
 * plugin của lần trước — mỗi test vì vậy phải `vi.resetModules()` rồi
 * `import('./registry')` lại từ đầu để có một `records` sạch.
 */

vi.mock('./installer', () => ({ installedPluginManifests: vi.fn() }));

function installedManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'installed-demo',
    label: 'Installed Demo',
    icon: FileJson,
    description: 'x',
    route: '/installed-demo',
    order: 100_000,
    defaultEnabled: true,
    sdk: '^1.0.0',
    load: async () => () => null,
    ...overrides,
  };
}

/**
 * `isTauri` (`@/lib/platform`) đọc `'__TAURI_INTERNALS__' in window` MỘT LẦN
 * lúc module được nạp — `initInstalledPlugins()` no-op ngay từ dòng đầu nếu
 * cờ này chưa được set TRƯỚC khi `./registry` (và qua nó, `@/lib/platform`)
 * được import lần đầu trong tiến trình test.
 */
async function freshRegistry() {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  return import('./registry');
}

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.resetModules();
});

describe('initInstalledPlugins', () => {
  it('không cài gì thì PLUGINS đúng bằng số plugin compile-time, không hơn', async () => {
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([]);

    const registry = await freshRegistry();
    const before = registry.PLUGINS.length;
    await registry.initInstalledPlugins();

    expect(registry.PLUGINS.length).toBe(before);
    expect(before).toBe(22);
  });

  it('thêm đúng một plugin hợp lệ vào PLUGINS và PLUGIN_MAP', async () => {
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      { manifest: installedManifest(), source: 'installed:installed-demo@1.0.0' },
    ]);

    const registry = await freshRegistry();
    const before = registry.PLUGINS.length;
    await registry.initInstalledPlugins();

    expect(registry.PLUGINS.length).toBe(before + 1);
    expect(registry.getPlugin('installed-demo')?.label).toBe('Installed Demo');
  });

  it('route đụng một plugin compile-time có sẵn thì bị từ chối, không đăng ký', async () => {
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      // '/json' đã là route của plugin compile-time 'json'.
      { manifest: installedManifest({ id: 'ke-gia-mao', route: '/json' }), source: 'installed:ke-gia-mao@1.0.0' },
    ]);

    const registry = await freshRegistry();
    const before = registry.PLUGINS.length;
    await registry.initInstalledPlugins();

    expect(registry.PLUGINS.length).toBe(before);
    expect(registry.getPlugin('ke-gia-mao')).toBeUndefined();
    expect(registry.PLUGIN_ERRORS.some((e) => e.reason.includes('/json'))).toBe(true);
  });

  it('order đụng một plugin compile-time có sẵn thì bị từ chối', async () => {
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      // order 10 chắc chắn đã bị một plugin compile-time chiếm (order tối đa
      // của installer.ts luôn bắt đầu từ 100_000, cách rất xa dải này).
      { manifest: installedManifest({ order: 10 }), source: 'installed:installed-demo@1.0.0' },
    ]);

    const registry = await freshRegistry();
    const before = registry.PLUGINS.length;
    await registry.initInstalledPlugins();

    expect(registry.PLUGINS.length).toBe(before);
  });

  it('hai plugin cài trùng id với nhau thì chỉ cái đầu được đăng ký', async () => {
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      { manifest: installedManifest({ route: '/a' }), source: 'a' },
      { manifest: installedManifest({ route: '/b' }), source: 'b' },
    ]);

    const registry = await freshRegistry();
    const before = registry.PLUGINS.length;
    await registry.initInstalledPlugins();

    expect(registry.PLUGINS.length).toBe(before + 1);
    expect(registry.getPlugin('installed-demo')?.route).toBe('/a');
  });

  it('plugin cài qua market: id vẫn TRẦN (không tiền tố), group mang tên market — usePluginSdkFor/getPluginSdk gọi bằng id trần vẫn tra được', async () => {
    // Mô phỏng đúng những gì installedPluginManifests() tự sinh cho một bản
    // cài có marketId (xem installer.ts): id KHÔNG bị tiền tố, group mới là
    // chỗ mang thông tin market — khác hẳn cơ chế `<marketId>-<id>` cũ.
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      {
        manifest: installedManifest({ id: 'container-manager', group: 'official', route: '/installed/official/container-manager' }),
        source: 'installed:official:container-manager@1.0.0',
      },
    ]);

    const registry = await freshRegistry();
    await registry.initInstalledPlugins();

    // Đúng chuỗi bundle của chính plugin tự gọi lại mình
    // (usePluginSdkFor('container-manager')/getPluginSdk('container-manager'))
    // — không cần biết registry đã gán group nào cho nó.
    const record = registry.getPlugin('container-manager');
    expect(record?.id).toBe('container-manager');
    expect(record?.group).toBe('official');
  });

  it('hai plugin cài trùng id (một qua URL trần, một qua market) — bản thứ hai vẫn bị registry từ chối như mọi trùng id khác', async () => {
    // registry.ts KHÔNG tự phân biệt group khi so trùng id — đó là việc của
    // installer.ts's assertNoConflictingInstall() (chặn NGAY LÚC CÀI, xem
    // installer.test.ts). Ở tầng registry, hai bản ghi cùng id trần luôn là
    // một collision phẳng, bất kể group — giống hệt "hai plugin cài trùng id
    // với nhau thì chỉ cái đầu được đăng ký" phía trên, chỉ khác nguồn cài.
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      {
        manifest: installedManifest({ id: 'container-manager', group: 'url', route: '/installed/url/container-manager' }),
        source: 'installed:url:container-manager@1.0.0',
      },
      {
        manifest: installedManifest({ id: 'container-manager', group: 'official', route: '/installed/official/container-manager', order: 100_001 }),
        source: 'installed:official:container-manager@1.0.0',
      },
    ]);

    const registry = await freshRegistry();
    await registry.initInstalledPlugins();

    expect(registry.getPlugin('container-manager')?.group).toBe('url');
    expect(registry.PLUGIN_ERRORS.some((e) => e.id === 'container-manager')).toBe(true);
  });

  it('manifest hỏng (thiếu route) bị loại vào PLUGIN_ERRORS, không làm hỏng những manifest hợp lệ khác', async () => {
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      { manifest: { ...installedManifest({ id: 'hong' }), route: '' }, source: 'hong' },
      { manifest: installedManifest({ id: 'lanh', route: '/lanh' }), source: 'lanh' },
    ]);

    const registry = await freshRegistry();
    await registry.initInstalledPlugins();

    expect(registry.getPlugin('hong')).toBeUndefined();
    expect(registry.getPlugin('lanh')).toBeDefined();
    expect(registry.PLUGIN_ERRORS.some((e) => e.id === 'hong')).toBe(true);
  });
});
