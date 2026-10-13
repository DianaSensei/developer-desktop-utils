import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * `isTauri` is read once at module load, so each test resets modules and
 * sets `__TAURI_INTERNALS__` before importing. `invoke` is routed by command
 * name; the catalog goes through the global `fetch`, mocked separately.
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

// Several commands run in one render (installed list, target triple,
// preview, install); route by command so each gets the right shape.
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
// In Tauri, market.ts uses tauri-plugin-http; route it to the global
// `fetch` so one `vi.stubGlobal('fetch', ...)` covers both paths.
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
    // The web build shows only the notice and must not fetch the catalog.
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

const BETA_URL = 'https://example.com/demo-plugin-beta.json';

/** Catalog whose demo plugin also publishes a beta build. */
function stubCatalogWithBeta(betaVersion = '1.1.0-beta.1') {
  manifestByUrl[BETA_URL] = { ...demoPluginManifest(), version: betaVersion };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(demoCatalog({ beta: { version: betaVersion, pluginManifestUrl: BETA_URL } }))),
  );
}

/** The demo plugin, installed from the official market at `version`. */
function installDemo(version: string, sourceUrl = 'https://example.com/demo-plugin.json') {
  installedArtifacts = [
    {
      kind: 'plugin',
      manifest: { ...demoPluginManifest(), version },
      source_url: sourceUrl,
      bundle_path: '/tmp/demo/bundle.mjs',
      installed_at: 1_700_000_000_000,
      market_id: 'official',
    },
  ];
}

describe('SettingsMarketplace — cài đặt (dialog xác nhận ngay tại trang, không chuyển tab)', () => {
  it('bấm Install mở dialog xem trước CẢ plugin lẫn service, một lần Cài đặt cài cả hai', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    // The dialog previews both URLs at once, on this page.
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
    stubCatalogWithBeta();

    await renderMarketplace();
    await settle();
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());

    expect(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Install Beta|Cài bản Beta/ })).toBeTruthy();
  });

  it('bấm "Install Beta" mở dialog xem trước ĐÚNG URL của bản beta, không phải bản stable', async () => {
    stubCatalogWithBeta();

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
    installDemo('1.1.0-beta.1', BETA_URL);
    stubCatalogWithBeta();

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
    installDemo('1.0.0');
    stubCatalogWithBeta();

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Switch to Beta|Chuyển sang Beta/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Switch to Stable|Chuyển về Stable/ })).toBeNull();
  });

  it('an older beta stays on the beta channel and offers the newer beta', async () => {
    installDemo('1.1.0-beta.1', BETA_URL);
    stubCatalogWithBeta('1.1.0-beta.2');

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/demo@1\.1\.0-beta\.1/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Update to 1\.1\.0-beta\.2|Cập nhật lên 1\.1\.0-beta\.2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Switch to Stable|Chuyển về Stable/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Switch to Beta|Chuyển sang Beta/ })).toBeNull();
  });

  it('an installed version newer than the catalog is not offered a downgrade', async () => {
    installDemo('1.2.0');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByRole('button', { name: /^Installed$|^Đã cài$/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Update to|Cập nhật lên/ })).toBeNull();
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
        // Rust sends `null`, not an absent field, for a record without a
        // market. Comparing with `=== undefined` once showed such records
        // as not installed.
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
