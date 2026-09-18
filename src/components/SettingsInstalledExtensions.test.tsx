import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp — cùng cái bẫy đã
 * ghi ở `installer.test.ts`/`SettingsExtensionInstaller.test.tsx`.
 * `vi.resetModules()` + gán `__TAURI_INTERNALS__` TRƯỚC khi
 * `import('@/components/SettingsInstalledExtensions')` là cách duy nhất để
 * mọi module transitively import `@/lib/platform` đọc đúng giá trị test này
 * cần.
 *
 * `settle()` NGAY SAU `renderInTauri()`: lần `import('@tauri-apps/api/core')`
 * ĐẦU TIÊN (bên trong `invokeCommand`, gọi lúc mount để `listInstalledArtifacts`
 * chạy) là một dynamic import thật, còn đang "in-flight" khi `render()` trả
 * về — xem giải thích đầy đủ ở `SettingsExtensionInstaller.test.tsx`'s bản gốc
 * (trước khi danh sách này tách ra thành component riêng).
 */
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

function pluginManifestRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'plugin',
    id: 'demo',
    version: '1.0.0',
    sdk: '^1.0.0',
    entry: 'https://example.com/demo/bundle.mjs',
    integrity: 'a'.repeat(64),
    label: 'Demo',
    description: 'Plugin ví dụ',
    icon: 'regex',
    keywords: [],
    route: '/demo',
    permissions: [],
    commands: [],
    hosts: [],
    ...overrides,
  };
}

function installedPluginRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'plugin' as const,
    manifest: pluginManifestRaw(),
    source_url: 'https://example.com/plugin.json',
    bundle_path: '/tmp/demo/1.0.0/bundle.mjs',
    installed_at: 1_700_000_000_000,
    ...overrides,
  };
}

function installedServiceRaw(overrides: Partial<Record<string, unknown>> = {}) {
  const { manifest: manifestOverrides, ...rest } = overrides;
  return {
    kind: 'service' as const,
    manifest: {
      bin: 'devtool-svc-demo',
      version: '1.0.0',
      protocol: 1,
      targets: { 'aarch64-apple-darwin': { url: 'https://example.com/svc/arm64', sha256: 'a'.repeat(64) } },
      ...(manifestOverrides as Record<string, unknown> | undefined),
    },
    source_url: 'https://example.com/svc.json',
    bin_path: '/tmp/services/devtool-svc-demo/1.0.0/devtool-svc-demo',
    installed_at: 1_700_000_000_000,
    ...rest,
  };
}

/**
 * `resetModules()` + import + render, dùng chung cho MỌI test cần một lần nạp
 * module riêng (isTauri đọc một lần lúc `@/lib/platform` được nạp — xem ghi
 * chú ở đầu file).
 */
async function renderInstalled(opts?: { tauri?: boolean }) {
  vi.resetModules();
  if (opts?.tauri ?? true) {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
  const { LocaleProvider } = await import('@/contexts/LocaleContext');
  const { ExtensionUpdateProvider } = await import('@/contexts/ExtensionUpdateContext');
  const { SettingsInstalledExtensions } = await import('@/components/SettingsInstalledExtensions');
  return render(
    <LocaleProvider>
      <ExtensionUpdateProvider>
        <SettingsInstalledExtensions />
      </ExtensionUpdateProvider>
    </LocaleProvider>,
  );
}

async function renderInTauri() {
  return renderInstalled({ tauri: true });
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  storageRemove('devtool-locale');
  vi.resetModules();
});

describe('SettingsInstalledExtensions — bản web (không phải Tauri)', () => {
  it('hiện cảnh báo, không gọi invoke', async () => {
    await renderInstalled({ tauri: false });

    expect(screen.getByText(/only works in the desktop app|chỉ hoạt động trên bản desktop/)).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('SettingsInstalledExtensions — danh sách rỗng (empty state)', () => {
  it('nói rõ chưa cài gì thay vì để trống', async () => {
    invokeMock.mockResolvedValueOnce([]); // artifact_installer_list lúc mount
    await renderInTauri();
    await settle();

    await waitFor(() => {
      expect(screen.getByText(/No extensions installed yet\.|Chưa cài tiện ích nào\./)).toBeTruthy();
    });
  });
});

describe('SettingsInstalledExtensions — danh sách hỗn hợp', () => {
  it('phân biệt badge theo kind (Plugin/Service)', async () => {
    invokeMock.mockResolvedValueOnce([installedPluginRaw(), installedServiceRaw()]); // list lúc mount
    await renderInTauri();
    await settle();

    await waitFor(() => {
      const badges = screen.getAllByText(/^(Plugin|Service)$/);
      expect(badges.map((b) => b.textContent).sort()).toEqual(['Plugin', 'Service']);
    });
  });
});

describe('SettingsInstalledExtensions — service đòi xác nhận trước khi cập nhật/gỡ', () => {
  it('bấm Gỡ trên một dòng service chỉ HIỆN cảnh báo, chưa gọi uninstall — phải bấm Xác nhận mới thật sự gỡ', async () => {
    invokeMock.mockResolvedValueOnce([installedServiceRaw()]); // list lúc mount
    await renderInTauri();
    await settle();

    await waitFor(() => expect(screen.getByText('devtool-svc-demo@1.0.0')).toBeTruthy());

    const row = screen.getByText('devtool-svc-demo@1.0.0').closest('div')!.parentElement!.parentElement!;
    const uninstallButton = within(row).getAllByRole('button').at(-1)!;
    fireEvent.click(uninstallButton);

    // Cảnh báo hiện ra, KHÔNG gọi uninstall ngay.
    await waitFor(() =>
      expect(
        screen.getByText(/will STOP this sidecar if it is running|sẽ DỪNG sidecar này nếu đang chạy/),
      ).toBeTruthy(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('artifact_installer_uninstall', expect.anything());

    invokeMock.mockResolvedValueOnce(undefined); // uninstall
    invokeMock.mockResolvedValueOnce([]); // refresh sau khi gỡ

    fireEvent.click(screen.getByRole('button', { name: /^Confirm$|^Xác nhận$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('artifact_installer_uninstall', { key: 'devtool-svc-demo' });
    });
  });

  it('bấm Huỷ ở cảnh báo thì không gọi uninstall, cảnh báo biến mất', async () => {
    invokeMock.mockResolvedValueOnce([installedServiceRaw()]); // list lúc mount
    await renderInTauri();
    await settle();

    await waitFor(() => expect(screen.getByText('devtool-svc-demo@1.0.0')).toBeTruthy());
    const row = screen.getByText('devtool-svc-demo@1.0.0').closest('div')!.parentElement!.parentElement!;
    const uninstallButton = within(row).getAllByRole('button').at(-1)!;
    fireEvent.click(uninstallButton);

    await waitFor(() =>
      expect(
        screen.getByText(/will STOP this sidecar if it is running|sẽ DỪNG sidecar này nếu đang chạy/),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$|^Huỷ$/ }));

    await waitFor(() =>
      expect(
        screen.queryByText(/will STOP this sidecar if it is running|sẽ DỪNG sidecar này nếu đang chạy/),
      ).toBeNull(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('artifact_installer_uninstall', expect.anything());
  });
});

describe('SettingsInstalledExtensions — gỡ một plugin', () => {
  it('bấm Gỡ trên một dòng plugin gọi uninstall NGAY, không cần xác nhận thêm', async () => {
    invokeMock.mockResolvedValueOnce([installedPluginRaw()]); // list lúc mount
    await renderInTauri();
    await settle();

    await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
    const row = screen.getByText('Demo').closest('div')!.parentElement!.parentElement!;
    const uninstallButton = within(row).getAllByRole('button').at(-1)!;

    invokeMock.mockResolvedValueOnce(undefined); // uninstall
    invokeMock.mockResolvedValueOnce([]); // refresh sau khi gỡ
    fireEvent.click(uninstallButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('artifact_installer_uninstall', { key: 'demo', marketId: undefined });
    });
    await waitFor(() => {
      expect(screen.getByText(/External extensions changed|Đã thay đổi tiện ích/)).toBeTruthy();
    });
  });
});
