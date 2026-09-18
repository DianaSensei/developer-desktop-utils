import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { SettingsPlugins } from '@/components/SettingsPlugins';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { ExtensionUpdateProvider } from '@/contexts/ExtensionUpdateContext';
import { PLUGINS, createPluginSdk, pluginAudit } from '@/platform';
import { storageRemove } from '@/lib/persistentStore';

/**
 * Panel này là chỗ DUY NHẤT người dùng nhìn thấy Platform, nên hai thứ phải
 * đúng: quyền hiện ra là quyền THẬT trong manifest (không phải danh sách chép
 * tay song song — chính thứ mô hình plugin sinh ra để xoá bỏ), và lời gọi BỊ
 * TỪ CHỐI phải hiện, vì đó là loại lỗi duy nhất không tự lộ ra ở chỗ khác.
 *
 * Nhật ký hoạt động ĐÓNG theo mặc định (xem SettingsPlugins.tsx) — mọi test
 * cần đọc nội dung nhật ký phải bấm mở trước qua `openAuditLog()`.
 */

function renderPanel() {
  return render(
    <LocaleProvider>
      <FeatureProvider>
        <ExtensionUpdateProvider>
          <SettingsPlugins />
        </ExtensionUpdateProvider>
      </FeatureProvider>
    </LocaleProvider>,
  );
}

function openAuditLog() {
  fireEvent.click(screen.getByRole('button', { name: /Show activity log|Hiện nhật ký/ }));
}

beforeEach(() => {
  pluginAudit.clear();
});

afterEach(() => {
  cleanup();
  pluginAudit.clear();
  storageRemove('devtool-locale');
  storageRemove('devtool-features');
});

describe('Settings — Plugins', () => {
  it('liệt kê mọi plugin của registry, kèm id', () => {
    renderPanel();
    for (const p of PLUGINS) {
      expect(screen.getAllByText(p.id).length, p.id).toBeGreaterThan(0);
    }
  });

  it('quyền hiển thị lấy thẳng từ manifest, không phải bảng chép tay', () => {
    const { container } = renderPanel();
    const apiClient = PLUGINS.find((p) => p.id === 'api-client')!;
    // Khoá theo `data-plugin` thay vì dò cây DOM: nhiều plugin cùng có quyền
    // 'storage', bắt nhầm hàng sẽ khiến test xanh trong khi hàng thật sai.
    const row = container.querySelector<HTMLElement>('[data-plugin="api-client"]')!;
    expect(row).toBeTruthy();
    for (const perm of apiClient.permissions) {
      expect(within(row).getByText(perm), perm).toBeTruthy();
    }
    expect(within(row).getByText(/mcp_/)).toBeTruthy();
  });

  it('nhật ký hoạt động đóng theo mặc định', () => {
    renderPanel();
    expect(screen.queryByPlaceholderText(/Search by tool id|Tìm theo id tool/)).toBeNull();
    expect(screen.getByRole('button', { name: /Show activity log|Hiện nhật ký/ })).toBeTruthy();
  });

  it('bấm mở thì hiện ô tìm kiếm và danh sách; lời gọi bị từ chối hiện kèm quyền còn thiếu', () => {
    const sdk = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    expect(() => sdk.storage.get('k')).toThrow();

    renderPanel();
    openAuditLog();

    expect(screen.getByPlaceholderText(/Search by tool id|Tìm theo id tool/)).toBeTruthy();
    // Cả ô "denied" lẫn hàng chứa nó đều khớp regex, nên khớp NHIỀU phần tử là
    // bình thường — điều cần khẳng định là có một phần tử nêu đúng quyền thiếu.
    const denied = screen.getAllByText(/denied|bị từ chối/);
    expect(denied.some((el) => el.textContent?.includes('storage'))).toBe(true);
  });

  it('nhật ký rỗng thì nói rõ là rỗng thay vì để khoảng trắng', () => {
    renderPanel();
    openAuditLog();
    expect(screen.getByText(/No calls yet|Chưa có lời gọi/)).toBeTruthy();
  });

  it('tìm theo id tool lọc đúng dòng, xoá ô tìm kiếm thì hiện lại đủ', () => {
    const first = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    const second = createPluginSdk({ ...PLUGINS[1], permissions: [], commands: [] });
    expect(() => first.storage.get('k')).toThrow();
    expect(() => second.storage.get('k')).toThrow();

    renderPanel();
    openAuditLog();
    // `p.id` cũng xuất hiện ở bảng quyền phía trên — dùng getAllByText, chỉ
    // cần khẳng định CÓ mặt (permission table + audit row) trước khi lọc.
    expect(screen.getAllByText(PLUGINS[0].id).length).toBeGreaterThan(1);
    expect(screen.getAllByText(PLUGINS[1].id).length).toBeGreaterThan(1);

    fireEvent.change(screen.getByPlaceholderText(/Search by tool id|Tìm theo id tool/), {
      target: { value: PLUGINS[0].id },
    });
    // Sau khi lọc: PLUGINS[0].id vẫn còn (bảng quyền + audit row còn lại),
    // PLUGINS[1].id chỉ còn ở bảng quyền (audit row của nó bị lọc mất) — so
    // sánh SỐ LẦN xuất hiện giảm đi đúng một, thay vì đòi vắng mặt hẳn.
    expect(screen.getAllByText(PLUGINS[0].id).length).toBeGreaterThan(1);
    expect(screen.getAllByText(PLUGINS[1].id).length).toBe(1);
  });

  it('từ khoá không khớp gì thì nói rõ, không để trắng danh sách', () => {
    const sdk = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    expect(() => sdk.storage.get('k')).toThrow();

    renderPanel();
    openAuditLog();
    fireEvent.change(screen.getByPlaceholderText(/Search by tool id|Tìm theo id tool/), {
      target: { value: 'khong-ton-tai' },
    });

    expect(screen.getByText(/No calls match|Không có lời gọi nào khớp/)).toBeTruthy();
  });
});
