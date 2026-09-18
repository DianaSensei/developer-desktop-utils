import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * Trước đây một URL xếp hàng đợi (deep link/market) ép tab "Cài từ URL" làm
 * tab hiện hành để lộ ra màn xem trước — giờ `ExtensionInstallDialog` tự mở
 * đè lên BẤT KỲ tab nào đang hiện, không cần ép chuyển tab nữa (xem
 * `SettingsExtensions.tsx`). File RIÊNG (dynamic import sau
 * `vi.resetModules()`) — cùng quy ước đã dùng ở
 * `SettingsExtensionInstaller.test.tsx`/`SettingsMarketplace.test.tsx`.
 *
 * Mock thẳng `@/platform` (không phải `@tauri-apps/api/core`'s `invoke`):
 * `SettingsMarketplace` (tab mặc định) và `ExtensionInstallDialog` cùng gọi
 * vài hàm của `@/platform` độc lập với nhau trong cùng một lần render —
 * chạm tới `invoke` qua `import('@tauri-apps/api/core')` ĐỘNG ở hai chỗ gần
 * như cùng lúc từng gây ra một cuộc đua module thật (một trong hai đi qua
 * bản Tauri THẬT thay vì bản giả), y hệt lý do `SettingsMarketplace.tsx`'s
 * comment đã ghi. Mock ở tầng `@/platform` tránh hẳn đường `invoke`/dynamic
 * import đó — không còn gì để đua.
 */

function pluginManifest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'plugin', id: 'demo', version: '1.0.0', sdk: '^1.0.0', entry: 'x', integrity: 'a'.repeat(64),
    label: 'Demo', description: 'd', icon: 'puzzle', keywords: [], route: '/demo',
    permissions: [], commands: [], hosts: [],
    ...overrides,
  };
}

vi.mock('@/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform')>();
  return {
    ...actual,
    listInstalledArtifacts: () => Promise.resolve([]),
    currentTargetTriple: () => Promise.resolve('x86_64-unknown-linux-gnu'),
    fetchArtifactManifestPreview: () => Promise.resolve(pluginManifest()),
    installArtifact: vi.fn().mockResolvedValue(pluginManifest()),
    // Gọi TRƯỚC installArtifact ở ExtensionInstallDialog — thật (không mock)
    // sẽ đi qua listInstalledPlugins() nội bộ của installer.ts (KHÔNG đi qua
    // barrel này, nên mock listInstalledArtifacts ở trên không chặn được),
    // rồi invoke() thật một lệnh Tauri không tồn tại trong jsdom.
    assertNoConflictingInstall: () => Promise.resolve(),
  };
});
// `market.ts` đi qua tauri-plugin-http (không phải `invoke`) khi `isTauri` —
// mock nó gọi thẳng `fetch` toàn cục để `vi.stubGlobal('fetch', ...)` áp
// dụng cho cả hai môi trường trong cùng test.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args) }));

async function renderPanel() {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ plugins: [] }) }));
  const { LocaleProvider } = await import('@/contexts/LocaleContext');
  const { ExtensionUpdateProvider } = await import('@/contexts/ExtensionUpdateContext');
  const { SettingsExtensions } = await import('@/components/SettingsExtensions');
  const { pendingInstall } = await import('@/lib/pendingInstall');
  return {
    pendingInstall,
    ...render(
      <LocaleProvider>
        <ExtensionUpdateProvider>
          <SettingsExtensions />
        </ExtensionUpdateProvider>
      </LocaleProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  storageRemove('devtool-locale');
  storageRemove('devtool-features');
  storageRemove('devtool-markets-custom');
  storageRemove('devtool-market-selected');
  vi.resetModules();
});

describe('Settings — Extensions — dialog cài đặt tự mở theo pendingInstall (deep link/market)', () => {
  it('không có gì đang chờ thì không có dialog nào, tab mặc định là Chợ tiện ích', async () => {
    vi.resetModules();
    await renderPanel();
    expect(screen.getByRole('button', { name: /Marketplace|Chợ tiện ích/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deep link đã xếp URL TRƯỚC khi mount (mở app nguội) thì tự mở dialog xác nhận, không im lặng bỏ lỡ', async () => {
    vi.resetModules();
    // Cùng một epoch module: enqueue TRƯỚC, rồi mới `import()` các
    // provider/component đọc `pendingInstall` — mô phỏng đúng thứ tự thật
    // (deepLink.ts enqueue rồi mới navigate tới Settings, nơi component này
    // mới mount).
    const { pendingInstall: earlyQueue } = await import('@/lib/pendingInstall');
    earlyQueue.enqueue(['https://example.com/plugin.json']);
    await renderPanel();

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    // Tab vẫn ở mặc định Chợ tiện ích — dialog chỉ đè lên trên, không ép
    // chuyển tab như hành vi cũ. `hidden: true` vì Radix Dialog tự đặt
    // `aria-hidden` lên phần còn lại của trang khi mở (đúng hành vi a11y),
    // nên `getByRole` mặc định sẽ không thấy nó nữa. `Tabs` cũng render một
    // bản đo-kích-thước ẩn song song (không có `aria-selected`) — lọc lấy
    // đúng nút thật.
    const marketplaceTabs = screen.getAllByRole('button', { name: /Marketplace|Chợ tiện ích/, hidden: true });
    const realTab = marketplaceTabs.find((el) => el.hasAttribute('aria-selected'))!;
    expect(realTab.getAttribute('aria-selected')).toBe('true');
  });

  it('đã đứng sẵn ở trang này mà một URL mới được xếp (link/market thứ hai) thì dialog tự mở, không cần remount', async () => {
    vi.resetModules();
    const { pendingInstall } = await renderPanel();
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      pendingInstall.enqueue(['https://example.com/plugin.json']);
    });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
