import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SettingsPlugins } from '@/components/SettingsPlugins';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { PLUGINS, createPluginSdk, pluginAudit } from '@/platform';
import { storageRemove } from '@/lib/persistentStore';

/**
 * Panel này là chỗ DUY NHẤT người dùng nhìn thấy Platform, nên hai thứ phải
 * đúng: quyền hiện ra là quyền THẬT trong manifest (không phải danh sách chép
 * tay song song — chính thứ mô hình plugin sinh ra để xoá bỏ), và lời gọi BỊ
 * TỪ CHỐI phải hiện, vì đó là loại lỗi duy nhất không tự lộ ra ở chỗ khác.
 */

function renderPanel() {
  return render(
    <LocaleProvider>
      <FeatureProvider>
        <SettingsPlugins />
      </FeatureProvider>
    </LocaleProvider>,
  );
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
    const redis = PLUGINS.find((p) => p.id === 'redis-client')!;
    // Khoá theo `data-plugin` thay vì dò cây DOM: nhiều plugin cùng có quyền
    // 'storage', bắt nhầm hàng sẽ khiến test xanh trong khi hàng thật sai.
    const row = container.querySelector<HTMLElement>('[data-plugin="redis-client"]')!;
    expect(row).toBeTruthy();
    for (const perm of redis.permissions) {
      expect(within(row).getByText(perm), perm).toBeTruthy();
    }
    expect(within(row).getByText(/mcp_respond/)).toBeTruthy();
  });

  it('lời gọi bị từ chối hiện trong nhật ký, kèm quyền còn thiếu', () => {
    const sdk = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    expect(() => sdk.storage.get('k')).toThrow();

    renderPanel();
    // Cả ô "denied" lẫn hàng chứa nó đều khớp regex, nên khớp NHIỀU phần tử là
    // bình thường — điều cần khẳng định là có một phần tử nêu đúng quyền thiếu.
    const denied = screen.getAllByText(/denied|bị từ chối/);
    expect(denied.some((el) => el.textContent?.includes('storage'))).toBe(true);
  });

  it('nhật ký rỗng thì nói rõ là rỗng thay vì để khoảng trắng', () => {
    renderPanel();
    expect(screen.getByText(/No calls yet|Chưa có lời gọi/)).toBeTruthy();
  });
});
