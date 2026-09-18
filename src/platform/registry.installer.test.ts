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

  it('plugin cài qua market: getPlugin() tra được cả bằng id đã tiền tố lẫn baseId gốc', async () => {
    // Mô phỏng đúng những gì installedPluginManifests() tự sinh cho một bản
    // cài có marketId (xem installer.ts): id đăng ký bị tiền tố
    // `<marketId>-`, baseId giữ nguyên id gốc plugin tự khai.
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      {
        manifest: installedManifest({ id: 'official-container-manager', baseId: 'container-manager', route: '/installed/official-container-manager' }),
        source: 'installed:official-container-manager@1.0.0',
      },
    ]);

    const registry = await freshRegistry();
    await registry.initInstalledPlugins();

    // Đúng registry id (dùng cho routing/storage/audit).
    expect(registry.getPlugin('official-container-manager')?.baseId).toBe('container-manager');
    // Đúng id GỐC — đây là cái bundle của chính plugin gọi lại chính mình
    // bằng (usePluginSdkFor('container-manager')/getPluginSdk('container-manager')).
    // Thiếu fallback này là đúng lỗi thật đã xảy ra: "Không có plugin
    // 'container-manager' trong registry" dù plugin ĐÃ cài và ĐANG render.
    expect(registry.getPlugin('container-manager')?.id).toBe('official-container-manager');
  });

  it('một plugin cài qua URL trần + CÙNG plugin đó cài lại qua market (trùng baseId) — bản thứ hai bị từ chối, không được phép nhận nhầm SDK của bản kia', async () => {
    // Kịch bản thật: người dùng cài "container-manager" qua URL manifest dán
    // tay trước (không marketId, giữ nguyên id gốc) — rồi sau đó cài lại
    // đúng plugin đó nhưng qua market "official". `id`/`route` của hai bản
    // ghi này KHÁC NHAU HOÀN TOÀN (một bên không tiền tố, một bên có) nên ba
    // kiểm tra seenIds/seenRoutes/seenOrders không bắt được gì — nếu không có
    // seenBaseIds, cả hai đăng ký "thành công", và getPluginSdk('container-manager')
    // gọi module-scope (không qua context) từ bên trong bản market sẽ ÂM THẦM
    // nhận nhầm sdk của bản URL-install (khớp PLUGIN_MAP theo đúng chuỗi
    // 'container-manager' trước khi kịp thử baseId) — sai storage/audit/quyền.
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      {
        manifest: installedManifest({ id: 'container-manager', baseId: 'container-manager', route: '/container-manager', order: 100_000 }),
        source: 'installed:container-manager@1.0.0',
      },
      {
        // order khác bản trên: chỉ seenBaseIds mới có thể bắt cặp này — nếu
        // vô tình để trùng order/route/id với bản kia, test sẽ pass vì một lý
        // do khác hoàn toàn, không kiểm được đúng thứ cần kiểm.
        manifest: installedManifest({ id: 'official-container-manager', baseId: 'container-manager', route: '/installed/official-container-manager', order: 100_001 }),
        source: 'installed:official-container-manager@1.0.0',
      },
    ]);

    const registry = await freshRegistry();
    await registry.initInstalledPlugins();

    // Bản đầu (URL trần) đăng ký bình thường.
    expect(registry.getPlugin('container-manager')?.id).toBe('container-manager');
    // Bản thứ hai (market) bị TỪ CHỐI rõ ràng — không được phép âm thầm tồn
    // tại song song rồi gây nhận nhầm danh tính ở getPluginSdk module-scope.
    expect(registry.getPlugin('official-container-manager')).toBeUndefined();
    expect(
      registry.PLUGIN_ERRORS.some((e) => e.id === 'official-container-manager' && e.reason.includes('container-manager')),
    ).toBe(true);
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
