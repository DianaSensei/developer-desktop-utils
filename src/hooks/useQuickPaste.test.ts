import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuickPaste, isMac, quickPasteHint } from '@/hooks/useQuickPaste';

/** Chưa có test nào — đường ⌘V "dán nhanh" thay toàn bộ nội dung một ô, dùng
 *  bởi nhiều tool nhận input dạng dán-để-xử-lý (JSON, Base64, mã hoá…). */

function keydownV(target: EventTarget, init: Partial<KeyboardEventInit> = {}) {
  const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'v', metaKey: true, ...init });
  target.dispatchEvent(evt);
  return evt;
}

describe('isMac / quickPasteHint', () => {
  it('gợi ý phím tắt khớp với giá trị isMac đọc được', () => {
    expect(quickPasteHint).toBe(isMac ? 'Press ⌘V to paste' : 'Press Ctrl+V to paste');
  });
});

describe('useQuickPaste', () => {
  const readText = vi.fn();
  beforeEach(() => {
    readText.mockReset();
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
  });

  it('enabled=false: không lắng nghe, clipboard không bị đọc', async () => {
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste, false));
    await act(async () => { keydownV(document.body); });
    expect(readText).not.toHaveBeenCalled();
  });

  it('⌘V ngoài ô nhập liệu: chặn hành vi mặc định NGAY (trước khi biết clipboard có gì), rồi gọi onPaste nếu có text', async () => {
    readText.mockResolvedValue('pasted content');
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste));
    const evt = keydownV(document.body);
    await act(async () => { await Promise.resolve(); });
    expect(evt.defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenCalledWith('pasted content');
  });

  it('clipboard rỗng: vẫn preventDefault, nhưng KHÔNG gọi onPaste (không thay nội dung ô bằng chuỗi rỗng)', async () => {
    readText.mockResolvedValue('');
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste));
    const evt = keydownV(document.body);
    await act(async () => { await Promise.resolve(); });
    expect(evt.defaultPrevented).toBe(true);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('đọc clipboard bị từ chối (lỗi quyền): nuốt lỗi trong im lặng, không throw ra ngoài', async () => {
    readText.mockRejectedValue(new Error('denied'));
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste));
    await expect(act(async () => { keydownV(document.body); await Promise.resolve(); await Promise.resolve(); }))
      .resolves.not.toThrow();
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('⌘V bên TRONG input/textarea bị bỏ qua — không chặn dán bình thường vào ô', async () => {
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const evt = keydownV(input);
    await act(async () => { await Promise.resolve(); });
    expect(evt.defaultPrevented).toBe(false);
    expect(readText).not.toHaveBeenCalled();
    input.remove();
  });

  it('⌥⌘V (kèm Alt) không phải tổ hợp dán nhanh', async () => {
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste));
    await act(async () => { keydownV(document.body, { altKey: true }); });
    expect(readText).not.toHaveBeenCalled();
  });

  it('Ctrl+V (Windows/Linux) cũng kích hoạt', async () => {
    readText.mockResolvedValue('x');
    const onPaste = vi.fn();
    renderHook(() => useQuickPaste(onPaste));
    await act(async () => { keydownV(document.body, { metaKey: false, ctrlKey: true }); await Promise.resolve(); });
    expect(onPaste).toHaveBeenCalledWith('x');
  });

  it('callback đổi giữa các lần render vẫn dùng bản MỚI NHẤT', async () => {
    readText.mockResolvedValue('x');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useQuickPaste(cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    await act(async () => { keydownV(document.body); await Promise.resolve(); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });

  it('unmount gỡ listener', async () => {
    const onPaste = vi.fn();
    const { unmount } = renderHook(() => useQuickPaste(onPaste));
    unmount();
    await act(async () => { keydownV(document.body); });
    expect(readText).not.toHaveBeenCalled();
  });
});
