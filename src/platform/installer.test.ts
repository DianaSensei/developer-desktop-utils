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

/** Hình dạng THÔ y hệt những gì `artifact_installer_fetch_manifest` phía
 *  Rust thực sự trả về cho nhánh plugin — internally-tagged theo `kind`,
 *  ghi phẳng. */
function remotePluginManifestRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return { kind: 'plugin', ...remoteManifest(overrides) };
}

function remoteServiceManifestRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'service',
    bin: 'devtool-svc-demo',
    version: '1.0.0',
    protocol: 1,
    targets: {
      'x86_64-apple-darwin': { url: 'https://example.com/svc/x64', sha256: 'a'.repeat(64) },
    },
    ...overrides,
  };
}

function installedPluginRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'plugin' as const,
    manifest: remoteManifest(),
    source_url: 'https://example.com/plugin.json',
    bundle_path: '/tmp/demo/1.0.0/bundle.mjs',
    installed_at: 1_700_000_000_000,
    ...overrides,
  };
}

function installedServiceRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'service' as const,
    manifest: {
      bin: 'devtool-svc-demo',
      version: '1.0.0',
      protocol: 1,
      targets: { 'x86_64-apple-darwin': { url: 'https://example.com/svc/x64', sha256: 'a'.repeat(64) } },
    },
    source_url: 'https://example.com/svc.json',
    bin_path: '/tmp/services/devtool-svc-demo/1.0.0/devtool-svc-demo',
    installed_at: 1_700_000_000_000,
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
  it('gọi đúng lệnh Rust (artifact_installer_*) với đúng tham số, và đổi record snake_case sang camelCase', async () => {
    const installer = await loadInTauri();

    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw());
    await expect(installer.fetchManifestPreview('https://example.com/plugin.json')).resolves.toMatchObject({
      id: 'demo',
    });
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_fetch_manifest', {
      url: 'https://example.com/plugin.json',
    });

    invokeMock.mockResolvedValueOnce(installedPluginRaw());
    const installed = await installer.installPlugin('https://example.com/plugin.json');
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_install', {
      sourceUrl: 'https://example.com/plugin.json',
    });
    expect(installed).toEqual({
      manifest: remoteManifest(),
      sourceUrl: 'https://example.com/plugin.json',
      bundlePath: '/tmp/demo/1.0.0/bundle.mjs',
      installedAt: 1_700_000_000_000,
    });

    invokeMock.mockResolvedValueOnce([]);
    await installer.uninstallPlugin('demo');
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_uninstall', { key: 'demo' });
  });

  it('listInstalledPlugins trên bản web (không phải Tauri) trả về rỗng, không gọi invoke', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const installer = await import('./installer');

    await expect(installer.listInstalledPlugins()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('listInstalledPlugins lọc bỏ bản ghi kind=service khỏi danh sách chung', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([installedPluginRaw(), installedServiceRaw()]);

    const plugins = await installer.listInstalledPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe('demo');
    expect((plugins[0] as unknown as Record<string, unknown>).kind).toBeUndefined();
  });

  it('fetchManifestPreview từ chối rõ ràng nếu URL khai kind=service', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce(remoteServiceManifestRaw());
    await expect(installer.fetchManifestPreview('https://example.com/svc.json')).rejects.toThrow('service');
  });

  it('installPlugin từ chối rõ ràng nếu bản ghi cài về là kind=service', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce(installedServiceRaw());
    await expect(installer.installPlugin('https://example.com/svc.json')).rejects.toThrow('service');
  });
});

describe('installService / listInstalledServices / uninstallService', () => {
  it('gọi đúng lệnh Rust (artifact_installer_*) với đúng tham số, và đổi record snake_case sang camelCase', async () => {
    const installer = await loadInTauri();

    invokeMock.mockResolvedValueOnce(installedServiceRaw());
    const installed = await installer.installService('https://example.com/svc.json');
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_install', {
      sourceUrl: 'https://example.com/svc.json',
    });
    expect(installed).toEqual({
      manifest: {
        bin: 'devtool-svc-demo',
        version: '1.0.0',
        protocol: 1,
        targets: { 'x86_64-apple-darwin': { url: 'https://example.com/svc/x64', sha256: 'a'.repeat(64) } },
      },
      sourceUrl: 'https://example.com/svc.json',
      binPath: '/tmp/services/devtool-svc-demo/1.0.0/devtool-svc-demo',
      installedAt: 1_700_000_000_000,
    });

    invokeMock.mockResolvedValueOnce([]);
    await installer.uninstallService('devtool-svc-demo');
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_uninstall', { key: 'devtool-svc-demo' });
  });

  it('listInstalledServices lọc bỏ bản ghi kind=plugin khỏi danh sách chung', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([installedPluginRaw(), installedServiceRaw()]);

    const services = await installer.listInstalledServices();
    expect(services).toHaveLength(1);
    expect(services[0].manifest.bin).toBe('devtool-svc-demo');
  });

  it('installService từ chối rõ ràng nếu bản ghi cài về là kind=plugin', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce(installedPluginRaw());
    await expect(installer.installService('https://example.com/plugin.json')).rejects.toThrow('plugin');
  });
});

describe('fetchArtifactManifestPreview / installArtifact / listInstalledArtifacts / uninstallArtifact', () => {
  it('trả nguyên union kind cho lớp gọi tự rẽ nhánh (dùng bởi SettingsExtensionInstaller)', async () => {
    const installer = await loadInTauri();

    invokeMock.mockResolvedValueOnce(remoteServiceManifestRaw());
    const preview = await installer.fetchArtifactManifestPreview('https://example.com/svc.json');
    expect(preview.kind).toBe('service');

    invokeMock.mockResolvedValueOnce([installedPluginRaw(), installedServiceRaw()]);
    const all = await installer.listInstalledArtifacts();
    expect(all.map((r) => r.kind).sort()).toEqual(['plugin', 'service']);
  });

  it('uninstallArtifact gọi đúng tham số key, dùng chung cho cả hai kind', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce(undefined);
    await installer.uninstallArtifact('devtool-svc-demo');
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_uninstall', { key: 'devtool-svc-demo' });
  });

  // pullfrog bắt đúng ở review #145: `market_id` phía Rust là `Option<String>`
  // KHÔNG có `skip_serializing_if`, nên một bản ghi không market ghi ra JSON
  // `"market_id": null` — KHÔNG phải vắng hẳn trường (`undefined`). So sánh
  // `=== undefined` ở phía TS (SettingsMarketplace's "đã cài" match) sẽ không
  // bao giờ khớp một bản ghi thật từ Rust, mời cài chồng thêm một bản nữa.
  it('market_id: null (bản ghi không market, ĐÚNG hình dạng Rust thật gửi) chuẩn hoá thành marketId: undefined', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      installedPluginRaw({ market_id: null }),
      installedServiceRaw({ market_id: null }),
    ]);
    const [plugin, service] = await installer.listInstalledArtifacts();
    expect(plugin.marketId).toBeUndefined();
    expect(service.marketId).toBeUndefined();
  });
});

describe('currentTargetTriple', () => {
  it('gọi đúng lệnh Rust và trả nguyên chuỗi triple', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce('aarch64-apple-darwin');
    await expect(installer.currentTargetTriple()).resolves.toBe('aarch64-apple-darwin');
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_current_target_triple', undefined);
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

    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw({ version: '1.10.0' }));
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

    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw({ version: '1.2.0' }));
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

    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw({ version: '1.9.9' }));
    await expect(installer.checkForUpdate(installedRecord)).resolves.toMatchObject({ available: false });
  });
});

describe('checkForServiceUpdate', () => {
  it('phát hiện bản mới cho service, cùng phép so sánh số như nhánh plugin', async () => {
    const installer = await loadInTauri();
    const installedRecord = {
      manifest: {
        bin: 'devtool-svc-demo',
        version: '1.2.0',
        protocol: 1,
        targets: {},
      },
      sourceUrl: 'https://example.com/svc.json',
      binPath: '/tmp/x',
      installedAt: 0,
    };

    invokeMock.mockResolvedValueOnce(remoteServiceManifestRaw({ version: '1.10.0' }));
    const result = await installer.checkForServiceUpdate(installedRecord);
    expect(result.available).toBe(true);
    expect(result.remote?.version).toBe('1.10.0');
  });

  it('từ chối rõ ràng nếu nguồn đã cài không còn khai kind=service', async () => {
    const installer = await loadInTauri();
    const installedRecord = {
      manifest: { bin: 'devtool-svc-demo', version: '1.0.0', protocol: 1, targets: {} },
      sourceUrl: 'https://example.com/svc.json',
      binPath: '/tmp/x',
      installedAt: 0,
    };

    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw());
    await expect(installer.checkForServiceUpdate(installedRecord)).rejects.toThrow('plugin');
  });
});

describe('checkAllForUpdates', () => {
  // Kiểm TUẦN TỰ theo đúng thứ tự mảng trả về từ `artifact_installer_list`
  // (không Promise.all — xem lý do ở comment của hàm) — nên mock theo THỨ TỰ
  // GỌI, cùng khuôn với mọi test khác trong file này, là đủ.
  it('trả về mọi artifact có bản mới, cả plugin lẫn service, bỏ qua mục đã up-to-date', async () => {
    const installer = await loadInTauri();
    const pluginUpToDate = installedPluginRaw({ manifest: remoteManifest({ id: 'up-to-date' }) });
    const pluginOutdated = installedPluginRaw({ manifest: remoteManifest({ id: 'outdated', version: '1.0.0' }) });
    const serviceOutdated = installedServiceRaw();

    invokeMock.mockResolvedValueOnce([pluginUpToDate, pluginOutdated, serviceOutdated]); // artifact_installer_list
    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw({ id: 'up-to-date', version: '1.0.0' })); // check up-to-date
    invokeMock.mockResolvedValueOnce(remotePluginManifestRaw({ id: 'outdated', version: '2.0.0' })); // check outdated plugin
    invokeMock.mockResolvedValueOnce(remoteServiceManifestRaw({ version: '2.0.0' })); // check outdated service

    const updates = await installer.checkAllForUpdates();
    expect(updates.map((u) => u.key).sort()).toEqual(['devtool-svc-demo', 'outdated']);
    expect(updates.find((u) => u.key === 'outdated')?.remoteVersion).toBe('2.0.0');
    expect(updates.find((u) => u.key === 'devtool-svc-demo')?.remoteVersion).toBe('2.0.0');
  });

  it('một nguồn lỗi (mạng, URL chết) chỉ loại đúng mục đó, không chặn kiểm các mục còn lại', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([installedPluginRaw({ manifest: remoteManifest({ id: 'broken' }) }), installedServiceRaw()]);
    invokeMock.mockRejectedValueOnce(new Error('mạng lỗi')); // check broken plugin
    invokeMock.mockResolvedValueOnce(remoteServiceManifestRaw({ version: '9.9.9' })); // check service, vẫn chạy tiếp

    const updates = await installer.checkAllForUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].key).toBe('devtool-svc-demo');
  });

  it('không cài gì thì trả về rỗng, không ném lỗi', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([]);
    await expect(installer.checkAllForUpdates()).resolves.toEqual([]);
  });

  it('index.json đọc lỗi thì coi như chưa cài gì, không ném lỗi ra ngoài', async () => {
    const installer = await loadInTauri();
    invokeMock.mockRejectedValueOnce(new Error('index.json hỏng'));
    await expect(installer.checkAllForUpdates()).resolves.toEqual([]);
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
      installedPluginRaw({ manifest: remoteManifest({ id: 'a', icon: 'regex' }) }),
      installedPluginRaw({ manifest: remoteManifest({ id: 'b', icon: 'ten-icon-khong-ton-tai' }) }),
    ]);

    const [a, b] = await installer.installedPluginManifests();
    expect(a.manifest.icon).toBe(Regex);
    expect(b.manifest.icon).toBe(Puzzle);
  });

  it('gán order sau MỌI plugin compile-time, theo đúng thứ tự trả về từ Rust', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      installedPluginRaw({ manifest: remoteManifest({ id: 'a' }) }),
      installedPluginRaw({ manifest: remoteManifest({ id: 'b' }) }),
    ]);

    const [a, b] = await installer.installedPluginManifests();
    expect(a.manifest.order).toBeGreaterThanOrEqual(100_000);
    expect(b.manifest.order).toBe(a.manifest.order + 1);
  });

  it('mang đúng permissions/commands/hosts/sdk từ manifest gốc, không đánh rơi trường nào', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      installedPluginRaw({
        manifest: remoteManifest({
          id: 'a',
          permissions: ['storage', 'http'],
          commands: [],
          hosts: ['api.example.com'],
          sdk: '^2.0.0',
        }),
      }),
    ]);

    const [a] = await installer.installedPluginManifests();
    expect(a.manifest.permissions).toEqual(['storage', 'http']);
    expect(a.manifest.hosts).toEqual(['api.example.com']);
    expect(a.manifest.sdk).toBe('^2.0.0');
  });

  it('installed_service lẫn trong danh sách chung không lọt vào registry plugin', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([installedPluginRaw({ manifest: remoteManifest({ id: 'a' }) }), installedServiceRaw()]);

    const manifests = await installer.installedPluginManifests();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].manifest.id).toBe('a');
  });

  it('index.json đọc lỗi thì coi như chưa cài gì, không chặn app khởi động', async () => {
    const installer = await loadInTauri();
    invokeMock.mockRejectedValueOnce(new Error('index.json hỏng'));

    await expect(installer.installedPluginManifests()).resolves.toEqual([]);
  });

  // `load` của mỗi manifest đổi ra ở đây gọi `artifact_installer_read_bundle`
  // rồi `import()` một URL `blob:` — jsdom không thực thi ES module qua
  // blob: URL thật (không có pipeline load/parse script như một trình duyệt
  // thật), nên phần NẠP THẬT của bundle KHÔNG được kiểm ở đây. Đây là khoảng
  // trống test đã biết, ghi lại chứ không giấu: cần một lần xác nhận thủ công
  // trên app thật (cài một plugin ví dụ, xác nhận nó thật sự render) trước
  // khi coi cơ chế này là đã kiểm chứng đầy đủ.

  it('không có marketId (dán tay/bản cài từ trước) thì giữ NGUYÊN id/route gốc', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([installedPluginRaw({ manifest: remoteManifest({ id: 'demo', route: '/demo' }) })]);

    const [a] = await installer.installedPluginManifests();
    expect(a.manifest.id).toBe('demo');
    expect(a.manifest.route).toBe('/demo');
  });

  it('có marketId thì id/route đăng ký registry được ghép marketId — hai market khác nhau cùng id KHÔNG đụng route/storage của nhau', async () => {
    const installer = await loadInTauri();
    invokeMock.mockResolvedValueOnce([
      installedPluginRaw({ manifest: remoteManifest({ id: 'demo', route: '/demo' }), market_id: 'official' }),
      installedPluginRaw({ manifest: remoteManifest({ id: 'demo', route: '/demo' }), market_id: 'custom-fork' }),
    ]);

    const [a, b] = await installer.installedPluginManifests();
    expect(a.manifest.id).toBe('official-demo');
    expect(a.manifest.route).toBe('/installed/official-demo');
    expect(b.manifest.id).toBe('custom-fork-demo');
    expect(b.manifest.route).toBe('/installed/custom-fork-demo');
    expect(a.manifest.id).not.toBe(b.manifest.id);
    expect(a.manifest.route).not.toBe(b.manifest.route);
  });
});

describe('recordKey', () => {
  it('plugin không có marketId dùng id trần — khớp hành vi cũ trước tính năng market', async () => {
    const installer = await loadInTauri();
    expect(installer.recordKey({ kind: 'plugin', manifest: remoteManifest(), sourceUrl: 'x', bundlePath: 'x', installedAt: 0 })).toBe(
      'demo',
    );
  });

  it('plugin có marketId dùng khoá ghép, phân biệt được hai bản ghi cùng id khác market', async () => {
    const installer = await loadInTauri();
    const a = installer.recordKey({
      kind: 'plugin', manifest: remoteManifest(), sourceUrl: 'x', bundlePath: 'x', installedAt: 0, marketId: 'official',
    });
    const b = installer.recordKey({
      kind: 'plugin', manifest: remoteManifest(), sourceUrl: 'x', bundlePath: 'x', installedAt: 0, marketId: 'custom-fork',
    });
    expect(a).not.toBe(b);
  });

  it('service luôn dùng bin trần, kể cả có marketId — market của service chỉ để hiển thị', async () => {
    const installer = await loadInTauri();
    const key = installer.recordKey({
      kind: 'service',
      manifest: { bin: 'devtool-svc-demo', version: '1.0.0', protocol: 1, targets: {} },
      sourceUrl: 'x',
      binPath: 'x',
      installedAt: 0,
      marketId: 'official',
    });
    expect(key).toBe('devtool-svc-demo');
  });
});
