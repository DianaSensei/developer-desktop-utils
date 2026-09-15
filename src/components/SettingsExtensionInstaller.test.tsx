import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp — cùng cái bẫy đã
 * ghi ở `installer.test.ts`. `vi.resetModules()` + gán `__TAURI_INTERNALS__`
 * TRƯỚC khi `import('@/components/SettingsExtensionInstaller')` là cách duy
 * nhất để mọi module transitively import `@/lib/platform` đọc đúng giá trị
 * test này cần.
 *
 * `settle()` NGAY SAU `renderInTauri()`: lần `import('@tauri-apps/api/core')`
 * ĐẦU TIÊN (bên trong `invokeCommand`, gọi lúc mount để `listInstalledArtifacts`
 * chạy) là một dynamic import thật, còn đang "in-flight" khi `render()` trả
 * về. Bắn thêm một sự kiện gọi `invoke` NGAY LẬP TỨC (không chờ gì) có thể đua
 * với chính lần import đó và (quan sát thực nghiệm) đôi khi request một bản
 * KHÔNG qua `vi.mock` — không phải lỗi ở component hay ở `installer.ts`, mà là
 * một cuộc đua giữa `resetModules()` + dynamic import trong bài test. Chờ một
 * nhịp (bọc trong `act` để React cũng flush kịp) trước khi tương tác tiếp là
 * đủ để loại cuộc đua này.
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

function serviceManifestRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'service',
    bin: 'devtool-svc-demo',
    version: '1.0.0',
    protocol: 1,
    targets: { 'aarch64-apple-darwin': { url: 'https://example.com/svc/arm64', sha256: 'a'.repeat(64) } },
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

async function renderInTauri() {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  // Cả `LocaleProvider` lẫn component đều phải đến từ CÙNG một lần nạp module
  // (sau `resetModules()`) — nạp `LocaleProvider` từ một graph module khác thì
  // `useContext` bên trong component không thấy đúng Provider, ném "must be
  // used within a LocaleProvider" dù JSX nhìn đúng.
  const { LocaleProvider } = await import('@/contexts/LocaleContext');
  const { SettingsExtensionInstaller } = await import('@/components/SettingsExtensionInstaller');
  return render(
    <LocaleProvider>
      <SettingsExtensionInstaller />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  storageRemove('devtool-locale');
  vi.resetModules();
});

describe('SettingsExtensionInstaller — bản web (không phải Tauri)', () => {
  it('hiện cảnh báo, không gọi invoke', async () => {
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { LocaleProvider } = await import('@/contexts/LocaleContext');
    const { SettingsExtensionInstaller } = await import('@/components/SettingsExtensionInstaller');
    render(
      <LocaleProvider>
        <SettingsExtensionInstaller />
      </LocaleProvider>,
    );

    expect(screen.getByText(/only works in the desktop app|chỉ hoạt động trên bản desktop/)).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('SettingsExtensionInstaller — danh sách rỗng (empty state)', () => {
  it('nói rõ chưa cài gì thay vì để trống', async () => {
    invokeMock.mockResolvedValueOnce([]); // artifact_installer_list lúc mount
    await renderInTauri();
    await settle();

    await waitFor(() => {
      expect(screen.getByText(/No extensions installed yet\.|Chưa cài tiện ích nào\./)).toBeTruthy();
    });
  });
});

describe('SettingsExtensionInstaller — xem trước (preview)', () => {
  it('trạng thái loading: nút Preview vô hiệu hoá trong lúc chờ, rồi hiện kết quả', async () => {
    invokeMock.mockResolvedValueOnce([]); // list lúc mount
    await renderInTauri();
    await settle();

    let resolveFetch: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    invokeMock.mockReturnValueOnce(pending);

    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/plugin.json' } });
    const previewButton = screen.getByRole('button', { name: /Preview|Xem trước/ });
    fireEvent.click(previewButton);

    await waitFor(() => expect((previewButton as HTMLButtonElement).disabled).toBe(true));

    resolveFetch(pluginManifestRaw());
    await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_fetch_manifest', {
      url: 'https://example.com/plugin.json',
    });
  });

  it('trạng thái lỗi: hiện thông báo lỗi từ Rust, không rơi vào success', async () => {
    invokeMock.mockResolvedValueOnce([]); // list lúc mount
    await renderInTauri();
    await settle();

    invokeMock.mockRejectedValueOnce(new Error('Server trả về 404 khi tải manifest'));
    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/broken.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));

    await waitFor(() => expect(screen.getByText(/Server trả về 404/)).toBeTruthy());
  });

  it('kind=service: hiển thị badge Service, target-triple máy hiện tại, và danh sách target manifest có', async () => {
    invokeMock.mockResolvedValueOnce([]); // list lúc mount
    await renderInTauri();
    await settle();

    invokeMock.mockResolvedValueOnce(serviceManifestRaw());
    invokeMock.mockResolvedValueOnce('aarch64-apple-darwin'); // current_target_triple

    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/svc.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));

    await waitFor(() => expect(screen.getByText('devtool-svc-demo@1.0.0')).toBeTruthy());
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_current_target_triple', undefined);
    expect(screen.getByText('Service')).toBeTruthy();
    // Xuất hiện Ở CẢ HAI chỗ: dòng "target máy này" và chip target manifest có
    // — cả hai đều đúng, chỉ cần khẳng định có ít nhất một, không phải đúng một.
    expect(screen.getAllByText(/aarch64-apple-darwin/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/The manifest has a build for this platform\.|Manifest có bản cho nền tảng này\./),
    ).toBeTruthy();
  });

  it('kind=service: nền tảng không khớp thì cảnh báo rõ, không đoán/thử triple khác', async () => {
    invokeMock.mockResolvedValueOnce([]); // list lúc mount
    await renderInTauri();
    await settle();

    invokeMock.mockResolvedValueOnce(serviceManifestRaw());
    invokeMock.mockResolvedValueOnce('x86_64-pc-windows-msvc'); // triple KHÔNG có trong manifest.targets

    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/svc.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));

    await waitFor(() =>
      expect(
        screen.getByText(
          /The manifest has NO build for this platform — install will be rejected\.|KHÔNG có bản cho nền tảng này/,
        ),
      ).toBeTruthy(),
    );
  });
});

describe('SettingsExtensionInstaller — cài đặt (success) và danh sách hỗn hợp', () => {
  it('cài xong thì bật cờ cần khởi động lại, và danh sách phân biệt badge theo kind', async () => {
    invokeMock.mockResolvedValueOnce([]); // list lúc mount
    await renderInTauri();
    await settle();

    invokeMock.mockResolvedValueOnce(pluginManifestRaw());
    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/plugin.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));
    await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());

    invokeMock.mockResolvedValueOnce(installedPluginRaw()); // install
    invokeMock.mockResolvedValueOnce([installedPluginRaw(), installedServiceRaw()]); // refresh sau khi cài

    fireEvent.click(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    await waitFor(() => {
      expect(screen.getByText(/External extensions changed|Đã thay đổi tiện ích/)).toBeTruthy();
    });
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_install', {
      sourceUrl: 'https://example.com/plugin.json',
    });

    const badges = screen.getAllByText(/^(Plugin|Service)$/);
    expect(badges.map((b) => b.textContent).sort()).toEqual(['Plugin', 'Service']);
  });
});

describe('SettingsExtensionInstaller — service đòi xác nhận trước khi cập nhật/gỡ', () => {
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
