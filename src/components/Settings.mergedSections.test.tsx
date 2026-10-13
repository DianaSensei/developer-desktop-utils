import { describe, expect, it, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderSettings } from '@/testSupport/renderSettings';

/**
 * Built-in plugin permissions live under Tools and storage location under
 * About; neither has its own nav entry.
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
    // This description only exists in SettingsPlugins.tsx's table.
    expect(
      screen.getByText(/Every tool already COMPILED INTO the app|Mỗi tool BIÊN DỊCH SẴN trong app/),
    ).toBeTruthy();
    // The activity log is still collapsed by default.
    expect(screen.getByRole('button', { name: /Show activity log/ })).toBeTruthy();
  });

  it('mục About hiện vị trí thư mục dữ liệu (trước đây tách ở mục Data & Storage)', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'about' } }]);
    expect(screen.getByRole('heading', { name: 'About', level: 2 })).toBeTruthy();
    expect(screen.getByText('Where your data is stored')).toBeTruthy();
  });
});
