import { afterEach, describe, expect, it, vi } from 'vitest';
import { Puzzle, Regex } from 'lucide-react';

/**
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp — cùng cái bẫy đã
 * ghi ở mcpBridge.test.ts của các tool khác. `vi.resetModules()` + gán
 * `__TAURI_INTERNALS__` TRƯỚC khi `await import('./installer')` là cách duy
 * nhất để `isTauri` bên trong installer.ts đọc đúng giá trị test này cần,
 * thay vì giá trị đã đóng băng từ lần import đầu tiên của tiến trình test.
 */

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

function remoteManifest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'demo',
    version: '1.0.0',
    sdk: '^1.0.0',
    entry: 'https://example.com/demo/bundle.mjs',
    integrity: 'a'.repeat(64),
    label: 'Demo',
    description: 'Plugin ví dụ',
    icon: 'regex',
    keywords: ['demo'],
    route: '/demo',
    permissions: [],
    commands: [],
    hosts: [],
    ...overrides,
  };
}

async function loadInTauri() {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  return import('./installer');
}

afterEach(() => {
  invokeMock.mockReset();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.resetModules();
});

describe('fetchManifestPreview / installPlugin / listInstalledPlugins / uninstallPlugin', () => {
  it('gọi đúng lệnh Rust với đúng tham số, và đổi record snake_case sang camelCase', async () => {
    const installer = await loadInTauri();

    invokeMock.mockResolvedValueOnce(remoteManifest());
    await expect(installer.fetchManifestPreview('https://example.com/plugin.json')).resolves.toMatchObject({
      id: 'demo',
    });
    expect(invokeMock).toHaveBeenCalledWith('plugin_installer_fetch_manifest', {
      url: 'https://example.com/plugin.json',
    });

    invokeMock.mockResolvedValueOnce({
      manifest: remoteManifest(),
      source_url: 'https://example.com/plugin.json',
      bundle_path: '/tmp/demo/1.0.0/bundle.mjs',
      installed_at: 1_700_000_000_000,
    });
    const installed = await installer.installPlugin('https://example.com/plugin.json');
    expect(installed).toEqual({
      manifest: remoteManifest(),
      sourceUrl: 'https://example.com/plugin.json',
      bundlePath: '/tmp/demo/1.0.0/bundle.mjs',
      installedAt: 1_700_000_000_000,
    });

    invokeMock.mockResolvedValueOnce([]);
    await installer.uninstallPlugin('demo');
    expect(invokeMock).toHaveBeenCalledWith('plugin_installer_uninstall', { id: 'demo' });
  });

  it('listInstalledPlugins trên bản web (không phải Tauri) trả về rỗng, không gọi invoke', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const installer = await import('./installer');

    await expect(installer.listInstalledPlugins()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('checkForUpdate', () => {
  it('phát hiện bản mới bằng SO SÁNH SỐ, không phải so chuỗi — "1.10.0" mới hơn "1.2.0"', async () => {
    const installer = await loadInTauri();
    const installedRecord = {
      manifest: remoteManifest({ version: '1.2.0' }),
      sourceUrl: 'https://example.com/plugin.json',
      bundlePath: '/tmp/x',
      installedAt: 0,
    };

    invokeMock.mockResolvedValueOnce(remoteManifest({ version: '1.10.0' }));
    const result = await installer.checkForUpdate(installedRecord);

    expect(result.available).toBe(true);
    expect(result.remote?.version).toBe('1.10.0');
  });

  it('cùng version thì không báo có bản mới', async () => {
    const installer = await loadInTauri();
    const installedRecord = {
      manifest: remoteManifest({ version: '1.2.0' }),
      sourceUrl: 'https://example.com/plugin.json',
      bundlePath: '/tmp/x',
      installedAt: 0,
    };

    invokeMock.mockResolvedValueOnce(remoteManifest({ version: '1.2.0' }));
    await expect(installer.checkForUpdate(installedRecord)).resolves.toMatchObject({ available: false });
  });

  it('version tại URL cũ hơn bản đã cài thì cũng không báo có bản mới', async () => {
    const installer = await loadInTauri();
    const installedRecord = {
      manifest: remoteManifest({ version: '2.0.0' }),
      sourceUrl: 'https://example.com/plugin.json',
      bundlePath: '/tmp/x',
      installedAt: 0,
    };

    invokeMock.mockResolvedValueOnce(remoteManifest({ version: '1.9.9' }));
    await expect(installer.checkForUpdate(installedRecord)).resolves.toMatchObject({ available: false });
  });
});

describe('installedPluginManifests — đổi RemotePluginManifest thành PluginManifest', () => {
  it('trên bản web trả về rỗng, không gọi invoke', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const installer = await import('./installer');

    await expect(installer.installedPluginManifests()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('tra icon theo tên; tên lạ rơi về Puzzle thay vì chặn cài đặt', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      { manifest: remoteManifest({ id: 'a', icon: 'regex' }), source_url: 'u', bundle_path: 'p', installed_at: 0 },
      { manifest: remoteManifest({ id: 'b', icon: 'ten-icon-khong-ton-tai' }), source_url: 'u', bundle_path: 'p', installed_at: 0 },
    ]);

    const [a, b] = await installer.installedPluginManifests();
    expect(a.manifest.icon).toBe(Regex);
    expect(b.manifest.icon).toBe(Puzzle);
  });

  it('gán order sau MỌI plugin compile-time, theo đúng thứ tự trả về từ Rust', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      { manifest: remoteManifest({ id: 'a' }), source_url: 'u', bundle_path: 'p', installed_at: 0 },
      { manifest: remoteManifest({ id: 'b' }), source_url: 'u', bundle_path: 'p', installed_at: 0 },
    ]);

    const [a, b] = await installer.installedPluginManifests();
    expect(a.manifest.order).toBeGreaterThanOrEqual(100_000);
    expect(b.manifest.order).toBe(a.manifest.order + 1);
  });

  it('mang đúng permissions/commands/hosts/sdk từ manifest gốc, không đánh rơi trường nào', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      {
        manifest: remoteManifest({
          id: 'a',
          permissions: ['storage', 'http'],
          commands: [],
          hosts: ['api.example.com'],
          sdk: '^2.0.0',
        }),
        source_url: 'u',
        bundle_path: 'p',
        installed_at: 0,
      },
    ]);

    const [a] = await installer.installedPluginManifests();
    expect(a.manifest.permissions).toEqual(['storage', 'http']);
    expect(a.manifest.hosts).toEqual(['api.example.com']);
    expect(a.manifest.sdk).toBe('^2.0.0');
  });

  it('index.json đọc lỗi thì coi như chưa cài gì, không chặn app khởi động', async () => {
    const installer = await loadInTauri();
    invokeMock.mockRejectedValueOnce(new Error('index.json hỏng'));

    await expect(installer.installedPluginManifests()).resolves.toEqual([]);
  });

  // `load` của mỗi manifest đổi ra ở đây gọi `plugin_installer_read_bundle`
  // rồi `import()` một URL `blob:` — jsdom không thực thi ES module qua
  // blob: URL thật (không có pipeline load/parse script như một trình duyệt
  // thật), nên phần NẠP THẬT của bundle KHÔNG được kiểm ở đây. Đây là khoảng
  // trống test đã biết, ghi lại chứ không giấu: cần một lần xác nhận thủ công
  // trên app thật (cài một plugin ví dụ, xác nhận nó thật sự render) trước
  // khi coi cơ chế này là đã kiểm chứng đầy đủ.
});
