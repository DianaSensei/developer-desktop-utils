import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp — cùng cái bẫy đã
 * ghi ở `SettingsExtensionInstaller.test.tsx`. `vi.resetModules()` + gán
 * `__TAURI_INTERNALS__` TRƯỚC khi `import('@/components/SettingsMarketplace')`
 * là cách duy nhất mọi module transitively import `@/lib/platform` đọc đúng
 * giá trị test này cần. `listInstalledArtifacts`/`currentTargetTriple`/xem
 * trước/cài đặt đều gọi `invoke` qua `@tauri-apps/api/core` — định tuyến
 * theo TÊN lệnh để không lẫn hình dạng trả về của nhau; catalog thì đi qua
 * `fetch` toàn cục (không phải `invoke`) — mock riêng đường đó.
 */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function demoCatalog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    plugins: [
      {
        id: 'demo',
        label: 'Demo',
        description: 'A demo plugin',
        version: '1.0.0',
        keywords: ['demo'],
        pluginManifestUrl: 'https://example.com/demo-plugin.json',
        serviceManifestUrl: 'https://example.com/demo-service.json',
        ...overrides,
      },
    ],
  };
}

function demoPluginManifest() {
  return {
    kind: 'plugin', id: 'demo', version: '1.0.0', sdk: '^1.0.0', entry: 'x', integrity: 'a'.repeat(64),
    label: 'Demo', description: 'A demo plugin', icon: 'puzzle', keywords: [], route: '/demo',
    permissions: [], commands: [], hosts: [],
  };
}

function demoServiceManifest() {
  return {
    kind: 'service', bin: 'devtool-svc-demo', version: '1.0.0', protocol: 1,
    targets: { 'aarch64-apple-darwin': { url: 'https://example.com/bin', sha256: 'a'.repeat(64) } },
  };
}

// invoke() thấy nhiều lệnh khác nhau trong CÙNG một lần render (danh sách đã
// cài, target-triple máy này, xem trước manifest theo URL, rồi cài thật) —
// định tuyến theo `command` (và `args.url` khi cần) thay vì một
// `mockResolvedValue` chung, để mỗi lệnh luôn thấy đúng hình dạng của nó.
let installedArtifacts: unknown[] = [];
let targetTriple = 'aarch64-apple-darwin';
const manifestByUrl: Record<string, unknown> = {
  'https://example.com/demo-plugin.json': demoPluginManifest(),
  'https://example.com/demo-service.json': demoServiceManifest(),
};
const installMock = vi.fn().mockResolvedValue({});

const invokeMock = vi.fn((command: string, args?: { url?: string }) => {
  switch (command) {
    case 'artifact_installer_list':
      return Promise.resolve(installedArtifacts);
    case 'artifact_installer_current_target_triple':
      return Promise.resolve(targetTriple);
    case 'artifact_installer_fetch_manifest':
      return Promise.resolve(manifestByUrl[args?.url ?? '']);
    case 'artifact_installer_install':
      return installMock(args);
    default:
      return Promise.resolve(undefined);
  }
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args) }));
// `market.ts` đi qua tauri-plugin-http (không phải `invoke`, không phải
// `fetch` toàn cục) khi `isTauri` — mock nó gọi thẳng `fetch` toàn cục để một
// `vi.stubGlobal('fetch', ...)` áp dụng cho cả hai môi trường trong cùng test.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args) }));

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function renderMarketplace(opts?: { tauri?: boolean }) {
  vi.resetModules();
  if (opts?.tauri ?? true) {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
  const { LocaleProvider } = await import('@/contexts/LocaleContext');
  const { SettingsMarketplace } = await import('@/components/SettingsMarketplace');
  return render(
    <LocaleProvider>
      <SettingsMarketplace />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  invokeMock.mockClear();
  installMock.mockClear();
  installedArtifacts = [];
  targetTriple = 'aarch64-apple-darwin';
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  storageRemove('devtool-locale');
  storageRemove('devtool-markets-custom');
  storageRemove('devtool-market-selected');
  vi.resetModules();
});

describe('SettingsMarketplace — bản web (không phải Tauri)', () => {
  it('hiện cảnh báo, không gọi fetch/invoke — kể cả effect tải catalog', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await renderMarketplace({ tauri: false });
    await settle();

    expect(screen.getByText(/only works in the desktop app|chỉ hoạt động trên bản desktop/)).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
    // Bản web chỉ hiện cảnh báo, không có gì để hiển thị — effect tải catalog
    // phải tự dừng ở `!isTauri`, không âm thầm bắn request không ai dùng tới.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SettingsMarketplace — tải catalog', () => {
  it('hiện danh sách plugin của market chính thức', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    expect(screen.getByText('A demo plugin')).toBeTruthy();
  });

  it('catalog rỗng thì nói rõ thay vì để trống', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ plugins: [] })));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/This market has no extensions yet\.|chưa có tiện ích nào\./)).toBeTruthy());
  });

  it('market lỗi thì hiện thông báo lỗi rõ ràng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 500)));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeTruthy());
  });
});

describe('SettingsMarketplace — cài đặt (dialog xác nhận ngay tại trang, không chuyển tab)', () => {
  it('bấm Install mở dialog xem trước CẢ plugin lẫn service, một lần Cài đặt cài cả hai', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    // Dialog xem trước cả hai URL cùng lúc, không rời trang/tab nào.
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('devtool-svc-demo@1.0.0')).toBeTruthy());

    fireEvent.click(within(dialog).getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    await waitFor(() => expect(installMock).toHaveBeenCalledTimes(2));
    expect(installMock).toHaveBeenCalledWith({ sourceUrl: 'https://example.com/demo-plugin.json', marketId: 'official' });
    expect(installMock).toHaveBeenCalledWith({ sourceUrl: 'https://example.com/demo-service.json', marketId: 'official' });
  });

  it('targets chỉ mang tính tham khảo: nền tảng máy không nằm trong targets thì CẢNH BÁO nhưng vẫn cho bấm Install', async () => {
    targetTriple = 'x86_64-pc-windows-msvc'; // không nằm trong targets bên dưới
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(demoCatalog({ targets: ['aarch64-apple-darwin'] }))),
    );

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    expect(screen.getByText(/No build for this machine|Không có bản cho nền tảng máy này/)).toBeTruthy();
    const installButton = screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }) as HTMLButtonElement;
    expect(installButton.disabled).toBe(false);
  });

  it('plugin có bản beta: chưa cài thì hiện CẢ hai nút Install và Install Beta', async () => {
    manifestByUrl['https://example.com/demo-plugin-beta.json'] = { ...demoPluginManifest(), version: '1.1.0-beta.1' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          demoCatalog({
            beta: { version: '1.1.0-beta.1', pluginManifestUrl: 'https://example.com/demo-plugin-beta.json' },
          }),
        ),
      ),
    );

    await renderMarketplace();
    await settle();
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());

    expect(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Install Beta|Cài bản Beta/ })).toBeTruthy();
  });

  it('bấm "Install Beta" mở dialog xem trước ĐÚNG URL của bản beta, không phải bản stable', async () => {
    manifestByUrl['https://example.com/demo-plugin-beta.json'] = { ...demoPluginManifest(), version: '1.1.0-beta.1' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          demoCatalog({
            beta: { version: '1.1.0-beta.1', pluginManifestUrl: 'https://example.com/demo-plugin-beta.json' },
          }),
        ),
      ),
    );

    await renderMarketplace();
    await settle();
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Install Beta|Cài bản Beta/ }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/demo@1\.1\.0-beta\.1/)).toBeTruthy());

    fireEvent.click(within(dialog).getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    await waitFor(() => expect(installMock).toHaveBeenCalledTimes(1));
    expect(installMock).toHaveBeenCalledWith({
      sourceUrl: 'https://example.com/demo-plugin-beta.json',
      marketId: 'official',
    });
  });

  it('đã cài bản beta thì hiện nút "Switch to Stable", KHÔNG phải "Switch to Beta"', async () => {
    installedArtifacts = [
      {
        kind: 'plugin',
        manifest: { ...demoPluginManifest(), version: '1.1.0-beta.1' },
        source_url: 'https://example.com/demo-plugin-beta.json',
        bundle_path: '/tmp/demo/bundle.mjs',
        installed_at: 1_700_000_000_000,
        market_id: 'official',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          demoCatalog({
            beta: { version: '1.1.0-beta.1', pluginManifestUrl: 'https://example.com/demo-plugin-beta.json' },
          }),
        ),
      ),
    );

    await renderMarketplace();
    await settle();

    // Hàng hiện version THẬT đã cài (bản beta), không phải version stable của
    // catalog — cùng lý do đã ghi trong MarketPluginCard.
    await waitFor(() => expect(screen.getByText(/demo@1\.1\.0-beta\.1/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Switch to Stable|Chuyển về Stable/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Switch to Beta|Chuyển sang Beta/ })).toBeNull();
    // Nút chính (cập nhật bản beta) bị vô hiệu vì đã là bản beta mới nhất.
    expect((screen.getByRole('button', { name: /^Installed$|^Đã cài$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('đã cài bản stable, có beta mới hơn thì hiện nút "Switch to Beta"', async () => {
    manifestByUrl['https://example.com/demo-plugin-beta.json'] = { ...demoPluginManifest(), version: '1.1.0-beta.1' };
    installedArtifacts = [
      {
        kind: 'plugin',
        manifest: demoPluginManifest(),
        source_url: 'https://example.com/demo-plugin.json',
        bundle_path: '/tmp/demo/bundle.mjs',
        installed_at: 1_700_000_000_000,
        market_id: 'official',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          demoCatalog({
            beta: { version: '1.1.0-beta.1', pluginManifestUrl: 'https://example.com/demo-plugin-beta.json' },
          }),
        ),
      ),
    );

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Switch to Beta|Chuyển sang Beta/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Switch to Stable|Chuyển về Stable/ })).toBeNull();
  });

  it('đã cài đúng bản mới nhất thì nút Install bị vô hiệu hoá, hiện "Installed"', async () => {
    installedArtifacts = [
      {
        kind: 'plugin',
        manifest: {
          id: 'demo', version: '1.0.0', sdk: '^1.0.0', entry: 'x', integrity: 'a'.repeat(64),
          label: 'Demo', description: 'd', icon: 'puzzle', keywords: [], route: '/demo',
          permissions: [], commands: [], hosts: [],
        },
        source_url: 'https://example.com/demo-plugin.json',
        bundle_path: '/tmp/demo/bundle.mjs',
        installed_at: 1_700_000_000_000,
        // Hình dạng THẬT Rust gửi cho một bản ghi không market — `null`, không
        // phải vắng hẳn trường (`Option<String>` không có
        // `skip_serializing_if`). Bug đã xảy ra: so `=== undefined` phía
        // component không khớp `null`, khiến bản ghi này (cài từ trước tính
        // năng market, không thuộc market nào) bị coi là CHƯA cài — nút vẫn
        // hiện "Install" thay vì "Installed", mời cài chồng thêm một bản nữa.
        market_id: null,
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByRole('button', { name: /^Installed$|^Đã cài$/ })).toBeTruthy());
    expect((screen.getByRole('button', { name: /^Installed$|^Đã cài$/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
