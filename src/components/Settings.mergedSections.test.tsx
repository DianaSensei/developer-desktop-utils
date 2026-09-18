import { describe, expect, it, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderSettings } from '@/testSupport/renderSettings';

/**
 * "Plugin" (quyền + nhật ký của tool biên dịch sẵn) và "Data & Storage" (vị
 * trí thư mục dữ liệu) không còn là mục riêng trong nav trái — Plugin gộp
 * vào Tools, Storage gộp vào About. Test này khẳng định nội dung thật sự có
 * mặt ở mục mới, và hai mục cũ không còn xuất hiện trong nav.
 */

afterEach(() => {
  cleanup();
});

describe('Settings — Plugin/Storage đã gộp, không còn mục riêng', () => {
  it('nav trái không còn nút "Plugins"/"Data & Storage"', () => {
    renderSettings();
    expect(screen.queryByRole('button', { name: 'Plugins' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Data & Storage' })).toBeNull();
  });

  it('mục Tools hiện cả danh sách bật/tắt LẪN bảng quyền plugin (trước đây tách ở mục Plugin)', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'tools' } }]);
    expect(screen.getByRole('heading', { name: 'Tools', level: 2 })).toBeTruthy();
    // Bảng quyền của SettingsPlugins.tsx — mô tả này chỉ có ở đó.
    expect(
      screen.getByText(/Every tool already COMPILED INTO the app|Mỗi tool BIÊN DỊCH SẴN trong app/),
    ).toBeTruthy();
    // Nhật ký hoạt động vẫn theo đúng quy tắc "đóng theo mặc định".
    expect(screen.getByRole('button', { name: /Show activity log/ })).toBeTruthy();
  });

  it('mục About hiện vị trí thư mục dữ liệu (trước đây tách ở mục Data & Storage)', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'about' } }]);
    expect(screen.getByRole('heading', { name: 'About', level: 2 })).toBeTruthy();
    expect(screen.getByText('Where your data is stored')).toBeTruthy();
  });
});
