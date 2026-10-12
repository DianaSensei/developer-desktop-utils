import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * A queued install (deep link or market) opens `ExtensionInstallDialog` over
 * whichever tab is showing. Modules are re-imported after `vi.resetModules()`
 * like the other Settings tests. `@/platform` is mocked directly because
 * concurrent dynamic imports of `@tauri-apps/api/core` raced the mock.
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
    // Called before installArtifact. The real one calls installer.ts's
    // internal listInstalledPlugins(), which this mock cannot intercept.
    assertNoConflictingInstall: () => Promise.resolve(),
  };
});
// In Tauri, market.ts uses tauri-plugin-http; route it to the global
// `fetch` so one `vi.stubGlobal('fetch', ...)` covers both paths.
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
    // Enqueue before importing the components, matching the real order
    // (deepLink.ts enqueues, then navigates to Settings).
    const { pendingInstall: earlyQueue } = await import('@/lib/pendingInstall');
    earlyQueue.enqueue(['https://example.com/plugin.json']);
    await renderPanel();

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/demo@1\.0\.0/)).toBeTruthy());
    // The default Marketplace tab stays selected; the dialog sits on top.
    // `hidden: true` because Radix Dialog sets aria-hidden on the rest of
    // the page. Tabs also renders a hidden measuring copy without
    // aria-selected; pick the real button.
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
