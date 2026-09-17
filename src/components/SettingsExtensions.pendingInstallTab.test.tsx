import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/**
 * pullfrog đã bắt đúng ở PR review: đặt "Chợ tiện ích" làm tab mặc định phá
 * luồng deep link `desktop-devtool-app://install` — chỉ tab "Cài từ URL"
 * mount `SettingsExtensionInstaller`, component DUY NHẤT biết kéo
 * `pendingInstall`. File RIÊNG (không import tĩnh `SettingsExtensions` ở đầu
 * file, chỉ `import()` động sau `vi.resetModules()`) — cùng quy ước đã dùng
 * ở `SettingsExtensionInstaller.test.tsx`: trộn một import tĩnh (từ describe
 * khác trong CÙNG file, chạy trước bất kỳ `resetModules()` nào) với
 * `import()` động lại chính module đó SAU `resetModules()` từng gây ra một
 * lỗi TDZ ("Cannot access 'runPreview' before initialization") khi hai bản
 * component ở hai epoch module khác nhau lẫn vào cùng cây React — tách file
 * loại bỏ hẳn khả năng đó.
 */

async function renderPanel() {
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
  storageRemove('devtool-locale');
  storageRemove('devtool-features');
  vi.resetModules();
});

describe('Settings — Extensions — tab mặc định theo pendingInstall (deep link/market)', () => {
  it('không có gì đang chờ thì mặc định vào tab Chợ tiện ích', async () => {
    vi.resetModules();
    await renderPanel();
    expect(screen.getByRole('button', { name: /Marketplace|Chợ tiện ích/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Install by URL|Cài từ URL/ }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('deep link đã xếp URL TRƯỚC khi mount (mở app nguội) thì tự mở tab Cài từ URL, không im lặng bỏ lỡ', async () => {
    vi.resetModules();
    // Cùng một epoch module: enqueue TRƯỚC, rồi mới `import()` các
    // provider/component đọc `pendingInstall` — mô phỏng đúng thứ tự thật
    // (deepLink.ts enqueue rồi mới navigate tới Settings, nơi component này
    // mới mount).
    const { pendingInstall: earlyQueue } = await import('@/lib/pendingInstall');
    earlyQueue.enqueue(['https://example.com/plugin.json']);
    await renderPanel();

    expect(screen.getByRole('button', { name: /Install by URL|Cài từ URL/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('đã đứng sẵn ở tab Chợ tiện ích mà một URL mới được xếp (link/market thứ hai) thì tự chuyển sang tab Cài từ URL', async () => {
    vi.resetModules();
    const { pendingInstall } = await renderPanel();
    expect(screen.getByRole('button', { name: /Marketplace|Chợ tiện ích/ }).getAttribute('aria-selected')).toBe(
      'true',
    );

    act(() => {
      pendingInstall.enqueue(['https://example.com/plugin.json']);
    });

    expect(screen.getByRole('button', { name: /Install by URL|Cài từ URL/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
