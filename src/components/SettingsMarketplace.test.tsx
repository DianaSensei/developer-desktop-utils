import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp — cùng cái bẫy đã
 * ghi ở `SettingsExtensionInstaller.test.tsx`. `vi.resetModules()` + gán
 * `__TAURI_INTERNALS__` TRƯỚC khi `import('@/components/SettingsMarketplace')`
 * là cách duy nhất mọi module transitively import `@/lib/platform` đọc đúng
 * giá trị test này cần. `listInstalledArtifacts`/`currentTargetTriple` gọi
 * `invoke` qua `@tauri-apps/api/core`; catalog thì đi qua `fetch` toàn cục
 * (không phải `invoke`) — mock riêng từng đường.
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

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
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
  const onInstallRequested = vi.fn();
  const utils = render(
    <LocaleProvider>
      <SettingsMarketplace onInstallRequested={onInstallRequested} />
    </LocaleProvider>,
  );
  return { onInstallRequested, ...utils };
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
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
    invokeMock.mockResolvedValue([]); // listInstalledArtifacts + currentTargetTriple (best-effort)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    expect(screen.getByText('A demo plugin')).toBeTruthy();
  });

  it('catalog rỗng thì nói rõ thay vì để trống', async () => {
    invokeMock.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ plugins: [] })));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/This market has no plugins yet\.|chưa có plugin nào\./)).toBeTruthy());
  });

  it('market lỗi thì hiện thông báo lỗi rõ ràng', async () => {
    invokeMock.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 500)));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeTruthy());
  });
});

describe('SettingsMarketplace — cài đặt (chuyển tiếp qua pendingInstall)', () => {
  it('bấm Install xếp cả URL plugin lẫn service vào hàng đợi rồi báo cha chuyển tab', async () => {
    invokeMock.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    const { onInstallRequested } = await renderMarketplace();
    await settle();
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    expect(onInstallRequested).toHaveBeenCalledTimes(1);
    const { pendingInstall } = await import('@/lib/pendingInstall');
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://example.com/demo-plugin.json', marketId: 'official' });
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://example.com/demo-service.json', marketId: 'official' });
  });

  it('targets chỉ mang tính tham khảo: nền tảng máy không nằm trong targets thì CẢNH BÁO nhưng vẫn cho bấm Install', async () => {
    invokeMock.mockResolvedValueOnce([]); // listInstalledArtifacts
    invokeMock.mockResolvedValueOnce('x86_64-pc-windows-msvc'); // currentTargetTriple — không nằm trong targets bên dưới
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

  it('đã cài đúng bản mới nhất thì nút Install bị vô hiệu hoá, hiện "Installed"', async () => {
    invokeMock.mockResolvedValueOnce([
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
    ]); // listInstalledArtifacts
    invokeMock.mockResolvedValueOnce('aarch64-apple-darwin'); // currentTargetTriple
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(demoCatalog())));

    await renderMarketplace();
    await settle();

    await waitFor(() => expect(screen.getByRole('button', { name: /^Installed$|^Đã cài$/ })).toBeTruthy());
    expect((screen.getByRole('button', { name: /^Installed$|^Đã cài$/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
