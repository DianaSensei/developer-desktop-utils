import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp — cùng cái bẫy đã
 * ghi ở `installer.test.ts`. `vi.resetModules()` + gán `__TAURI_INTERNALS__`
 * TRƯỚC khi `import('@/components/SettingsExtensionInstaller')` là cách duy
 * nhất để mọi module transitively import `@/lib/platform` đọc đúng giá trị
 * test này cần.
 *
 * Danh sách "đã cài" (gỡ/cập nhật) không còn ở component này nữa — xem
 * `SettingsInstalledExtensions.test.tsx`. File này chỉ còn phủ form "cài từ
 * URL": xem trước + cài, không có gì gọi `listInstalledArtifacts` lúc mount
 * nữa nên không cần mock "list lúc mount" như bản cũ.
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
async function renderInstaller(opts?: { tauri?: boolean }) {
  vi.resetModules();
  if (opts?.tauri ?? true) {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
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

async function renderInTauri() {
  return renderInstaller({ tauri: true });
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
    await renderInstaller({ tauri: false });

    expect(screen.getByText(/only works in the desktop app|chỉ hoạt động trên bản desktop/)).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('SettingsExtensionInstaller — xem trước (preview)', () => {
  it('trạng thái loading: nút Preview vô hiệu hoá trong lúc chờ, rồi hiện kết quả', async () => {
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
    await renderInTauri();
    await settle();

    invokeMock.mockRejectedValueOnce(new Error('Server trả về 404 khi tải manifest'));
    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/broken.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));

    await waitFor(() => expect(screen.getByText(/Server trả về 404/)).toBeTruthy());
  });

  it('kind=service: hiển thị badge Service, target-triple máy hiện tại, và danh sách target manifest có', async () => {
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

    // kind=service KHÔNG đi qua assertNoConflictingInstall (chỉ áp dụng cho
    // plugin) — bấm Install ở đây phải đi thẳng tới artifact_installer_install,
    // không có lệnh list nào chen vào trước.
    invokeMock.mockResolvedValueOnce(installedServiceRaw());
    fireEvent.click(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    await waitFor(() => {
      expect(screen.getByText(/External extensions changed|Đã thay đổi tiện ích/)).toBeTruthy();
    });
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_install', {
      sourceUrl: 'https://example.com/svc.json',
    });
  });

  it('kind=service: nền tảng không khớp thì cảnh báo rõ, không đoán/thử triple khác', async () => {
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

  it('kind=plugin có khai service: sidecar đó CHƯA cài thì cảnh báo ngay ở bước xem trước', async () => {
    await renderInTauri();
    await settle();

    invokeMock.mockResolvedValueOnce(
      pluginManifestRaw({ service: { bin: 'devtool-svc-redis', methods: ['list'] } }),
    );
    invokeMock.mockResolvedValueOnce([]); // listInstalledArtifacts — chưa cài gì

    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/plugin.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));

    await waitFor(() => expect(screen.getByText(/devtool-svc-redis/)).toBeTruthy());
  });

  it('kind=plugin có khai service NHƯNG sidecar đó ĐÃ cài rồi thì không cảnh báo gì', async () => {
    await renderInTauri();
    await settle();

    invokeMock.mockResolvedValueOnce(
      pluginManifestRaw({ service: { bin: 'devtool-svc-redis', methods: ['list'] } }),
    );
    invokeMock.mockResolvedValueOnce([
      {
        kind: 'service',
        manifest: { bin: 'devtool-svc-redis', version: '1.0.0', protocol: 1, targets: {} },
        source_url: 'https://example.com/svc.json',
        bin_path: '/tmp/devtool-svc-redis',
        installed_at: 0,
      },
    ]);

    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/plugin.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));

    await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
    expect(screen.queryByText(/devtool-svc-redis/)).toBeNull();
  });
});

describe('SettingsExtensionInstaller — cài đặt (success)', () => {
  it('cài xong thì bật cờ cần khởi động lại', async () => {
    await renderInTauri();
    await settle();

    invokeMock.mockResolvedValueOnce(pluginManifestRaw());
    const input = screen.getByPlaceholderText('https://example.com/extension.json');
    fireEvent.change(input, { target: { value: 'https://example.com/plugin.json' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview|Xem trước/ }));
    await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());

    invokeMock.mockResolvedValueOnce([]); // list, assertNoConflictingInstall trước khi cài
    invokeMock.mockResolvedValueOnce(pluginManifestRaw()); // wrapped as InstalledPluginRecord by Rust normally; shape doesn't matter here

    fireEvent.click(screen.getByRole('button', { name: /^Install$|^Cài đặt$/ }));

    await waitFor(() => {
      expect(screen.getByText(/External extensions changed|Đã thay đổi tiện ích/)).toBeTruthy();
    });
    expect(invokeMock).toHaveBeenCalledWith('artifact_installer_install', {
      sourceUrl: 'https://example.com/plugin.json',
    });
  });
});

// Bài test "hàng đợi desktop-devtool-app://install (pendingInstall)" trước
// đây thuộc file này đã bị XOÁ: `SettingsExtensionInstaller` không còn nghe
// `pendingInstall` nữa (tab "Cài từ URL" giờ chỉ phục vụ URL người dùng tự
// dán tay) — một lượt cài tới từ deep link/market giờ hiện thẳng
// `ExtensionInstallDialog`, đè lên trang `SettingsExtensions`, không rơi
// vào tab này nữa. Xem `SettingsExtensions.pendingInstallTab.test.tsx` cho
// hành vi mới.
