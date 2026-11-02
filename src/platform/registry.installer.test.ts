import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileJson } from 'lucide-react';
import type { PluginManifest } from './types';

/**
 * `initInstalledPlugins()` appends to the same `records` array as built-in
 * plugins. Kept apart from `registry.test.ts` because registry.ts is a
 * module singleton: each test resets modules and re-imports it.
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
 * `isTauri` is read once at module load; set the flag before the first
 * import of './registry'.
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
      // '/json' is the built-in 'json' plugin's route.
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
      // Order 10 belongs to a built-in plugin; installed orders start at 100_000.
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
    // What installedPluginManifests() produces for a market install: a bare
    // id with the market in `group`.
    const { installedPluginManifests } = await import('./installer');
    vi.mocked(installedPluginManifests).mockResolvedValue([
      {
        manifest: installedManifest({ id: 'container-manager', group: 'official', route: '/installed/official/container-manager' }),
        source: 'installed:official:container-manager@1.0.0',
      },
    ]);

    const registry = await freshRegistry();
    await registry.initInstalledPlugins();

    // The id the plugin's own bundle uses to look itself up.
    const record = registry.getPlugin('container-manager');
    expect(record?.id).toBe('container-manager');
    expect(record?.group).toBe('official');
  });

  it('hai plugin cài trùng id (một qua URL trần, một qua market) — bản thứ hai vẫn bị registry từ chối như mọi trùng id khác', async () => {
    // The registry does not distinguish groups for id collisions;
    // installer.ts prevents them at install time.
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
