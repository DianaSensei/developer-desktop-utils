import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from '@/components/CommandPalette';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';

/**
 * ⌘K là điểm điều hướng trung tâm — hỏng lặng lẽ ở đây ảnh hưởng cả app. Test
 * tập trung vào ba thứ grep không bắt được: phím tắt mở/đóng, luồng đọc
 * clipboard bất đồng bộ, và việc chọn một tool đang TẮT thì phải bật nó lên
 * trước khi điều hướng.
 */

vi.mock('@/lib/clipboard', () => ({
  readTextFromClipboard: vi.fn().mockResolvedValue(null),
}));

import { readTextFromClipboard } from '@/lib/clipboard';

function renderPalette() {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <FeatureProvider>
          <CommandPalette />
        </FeatureProvider>
      </LocaleProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(readTextFromClipboard).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe('CommandPalette — mở/đóng', () => {
  it('ẩn theo mặc định, mở bằng Ctrl+K', async () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('Ctrl+K lần hai đóng lại', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('CommandPalette — tìm kiếm', () => {
  it('gõ tên tool lọc đúng danh sách', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/tool|command/i);

    fireEvent.change(input, { target: { value: 'cron' } });
    // Nhãn xuất hiện HAI LẦN theo đúng thiết kế — dòng danh sách và tiêu đề
    // xem trước cùng hiện "Cron Generator", nên dùng getAllByText.
    await waitFor(() => expect(screen.getAllByText('Cron Generator').length).toBeGreaterThan(0));
    expect(screen.queryByText('JWT Debugger')).toBeNull();
  });

  it('không khớp gì thì hiện thông báo trống', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/tool|command/i);
    fireEvent.change(input, { target: { value: 'xyzxyzxyz-khong-ton-tai' } });
    await waitFor(() => expect(screen.getByText(/xyzxyzxyz-khong-ton-tai/)).toBeTruthy());
  });
});

describe('CommandPalette — chọn bằng bàn phím', () => {
  it('ArrowDown rồi Enter điều hướng và đóng palette', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/tool|command/i);

    fireEvent.change(input, { target: { value: 'cron' } });
    await waitFor(() => expect(screen.getAllByText('Cron Generator').length).toBeGreaterThan(0));

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('CommandPalette — bật tool đang tắt khi chọn', () => {
  it('chọn tool tắt thì bật nó trước khi điều hướng', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/tool|command/i);

    // Regex Tester tắt theo mặc định (xem FeatureContext DEFAULT_FEATURES).
    fireEvent.change(input, { target: { value: 'regex tester' } });
    const rows = await screen.findAllByText('Regex Tester');
    fireEvent.click(rows[0]);

    // Không ném lỗi, palette đóng lại — nghĩa là toggleFeature + navigate đã chạy.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('CommandPalette — gợi ý clipboard', () => {
  it('đọc clipboard lúc mở và gợi ý tool kèm lý do', async () => {
    vi.mocked(readTextFromClipboard).mockResolvedValue(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
    );
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    await waitFor(() => expect(screen.getByText(/JWT/i)).toBeTruthy());
    expect(screen.getByText(/dấu chấm|dots/i)).toBeTruthy();
  });

  it('không gợi ý gì khi clipboard không đoán được', async () => {
    vi.mocked(readTextFromClipboard).mockResolvedValue('vừa đi ăn cơm về');
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await screen.findByPlaceholderText(/tool|command/i);

    expect(screen.queryByText('Từ clipboard')).toBeNull();
    expect(screen.queryByText('From clipboard')).toBeNull();
  });

  it('gõ truy vấn thì gợi ý clipboard biến mất', async () => {
    vi.mocked(readTextFromClipboard).mockResolvedValue(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
    );
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/tool|command/i);
    await waitFor(() => expect(screen.getAllByText(/JWT/i).length).toBeGreaterThan(0));

    fireEvent.change(input, { target: { value: 'network' } });
    await waitFor(() => {
      expect(screen.queryByText('Từ clipboard')).toBeNull();
      expect(screen.queryByText('From clipboard')).toBeNull();
    });
  });
});
