import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useDesktopChrome } from '@/hooks/useDesktopChrome';

/**
 * Chặn các phím tắt kiểu trình duyệt (⌘R tải lại mất state, ⌘W đóng cửa sổ,
 * Backspace lùi trang…) — sai một nhánh ở đây thì người dùng gõ Backspace
 * trong ô input bình thường lại bị chặn, hoặc tệ hơn, ⌘R vẫn lọt qua và xoá
 * sạch state đang làm dở. Chưa có test nào trước đây.
 */

function keydown(target: EventTarget, init: KeyboardEventInit) {
  const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(evt);
  return evt;
}

afterEach(cleanup);

describe('useDesktopChrome', () => {
  it('chặn menu chuột phải của WebView trên toàn trang', () => {
    renderHook(() => useDesktopChrome());
    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    document.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('Backspace/Delete NGOÀI ô nhập liệu bị chặn (không cho lùi trang)', () => {
    renderHook(() => useDesktopChrome());
    expect(keydown(document.body, { key: 'Backspace' }).defaultPrevented).toBe(true);
    expect(keydown(document.body, { key: 'Delete' }).defaultPrevented).toBe(true);
  });

  it('Backspace/Delete BÊN TRONG input/textarea vẫn hoạt động bình thường', () => {
    // Nhánh `el.isContentEditable` của `isEditable()` không test được ở đây —
    // jsdom không cài đặt getter đó (luôn `undefined`, kể cả khi đã đặt
    // `contenteditable="true"` bằng tay); đây là giới hạn của jsdom, không
    // phải lỗi nguồn. Hai nhánh INPUT/TEXTAREA (phần chính của isEditable)
    // vẫn kiểm được đầy đủ.
    renderHook(() => useDesktopChrome());
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    document.body.append(input, textarea);

    expect(keydown(input, { key: 'Backspace' }).defaultPrevented).toBe(false);
    expect(keydown(textarea, { key: 'Delete' }).defaultPrevented).toBe(false);

    input.remove(); textarea.remove();
  });

  it('⌘[ / ⌘] (điều hướng lịch sử) bị chặn LUÔN, kể cả trong ô nhập liệu', () => {
    renderHook(() => useDesktopChrome());
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(keydown(input, { key: '[', metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown(document.body, { key: ']', metaKey: true }).defaultPrevented).toBe(true);
    input.remove();
  });

  it('⌘R / Ctrl+R (tải lại, xoá sạch state React) bị chặn luôn, không phân biệt hệ điều hành', () => {
    renderHook(() => useDesktopChrome());
    expect(keydown(document.body, { key: 'r', metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown(document.body, { key: 'R', ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('⌘F / ⌘P / ⌘W bị chặn luôn (thanh tìm kiếm gốc, in, đóng cửa sổ)', () => {
    renderHook(() => useDesktopChrome());
    expect(keydown(document.body, { key: 'f', metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown(document.body, { key: 'p', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(keydown(document.body, { key: 'w', metaKey: true }).defaultPrevented).toBe(true);
  });

  it('⌘←/→ và Alt+←/→ NGOÀI ô nhập liệu bị chặn (điều hướng lịch sử)', () => {
    renderHook(() => useDesktopChrome());
    expect(keydown(document.body, { key: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown(document.body, { key: 'ArrowRight', altKey: true }).defaultPrevented).toBe(true);
  });

  it('⌘←/→ BÊN TRONG ô nhập liệu không bị chặn — vẫn cần di chuyển con trỏ trong text', () => {
    renderHook(() => useDesktopChrome());
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(keydown(input, { key: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
    input.remove();
  });

  it('phím thường (không kèm modifier, không phải Backspace/Delete) không bị đụng tới', () => {
    renderHook(() => useDesktopChrome());
    expect(keydown(document.body, { key: 'a' }).defaultPrevented).toBe(false);
    expect(keydown(document.body, { key: 'Enter' }).defaultPrevented).toBe(false);
  });

  it('unmount gỡ cả hai listener — sự kiện sau đó không còn bị chặn', () => {
    const { unmount } = renderHook(() => useDesktopChrome());
    unmount();
    expect(keydown(document.body, { key: 'r', metaKey: true }).defaultPrevented).toBe(false);
    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    document.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});
