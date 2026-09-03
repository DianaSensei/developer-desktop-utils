import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImagePaste } from '@/hooks/useImagePaste';
import * as clipboard from '@/lib/clipboard';

/** Chưa có test nào — đường dán ảnh (⌘V ngoài ô nhập liệu, hoặc sự kiện paste
 *  gốc có kèm file ảnh) dùng bởi các tool nhận ảnh (QR, Base64 ảnh…). */

vi.mock('@/lib/clipboard', () => ({ readImageFromClipboard: vi.fn() }));

function keydownV(target: EventTarget, init: Partial<KeyboardEventInit> = {}) {
  const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'v', metaKey: true, ...init });
  target.dispatchEvent(evt);
  return evt;
}

function pasteWithImage(file: File | null) {
  const evt = new Event('paste', { bubbles: true, cancelable: true });
  const items = file
    ? [{ kind: 'file', type: file.type, getAsFile: () => file }]
    : [];
  Object.defineProperty(evt, 'clipboardData', { value: { items } });
  window.dispatchEvent(evt);
  return evt;
}

describe('useImagePaste — đường ⌘V (đọc clipboard qua API)', () => {
  beforeEach(() => { vi.mocked(clipboard.readImageFromClipboard).mockReset(); });

  it('enabled=false: không lắng nghe gì, readImageFromClipboard không được gọi', async () => {
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage, false));
    await act(async () => { keydownV(document.body); });
    expect(clipboard.readImageFromClipboard).not.toHaveBeenCalled();
  });

  it('⌘V ngoài ô nhập liệu, có ảnh trên clipboard → gọi onImage với data URL', async () => {
    vi.mocked(clipboard.readImageFromClipboard).mockResolvedValue('data:image/png;base64,x');
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    await act(async () => { keydownV(document.body); });
    expect(onImage).toHaveBeenCalledWith('data:image/png;base64,x');
  });

  it('⌘V nhưng clipboard không có ảnh → không gọi onImage, không preventDefault', async () => {
    vi.mocked(clipboard.readImageFromClipboard).mockResolvedValue(null);
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    const evt = keydownV(document.body);
    await act(async () => { await Promise.resolve(); });
    expect(onImage).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });

  it('⌘V bên TRONG input/textarea bị bỏ qua — để trình duyệt dán TEXT bình thường', async () => {
    vi.mocked(clipboard.readImageFromClipboard).mockResolvedValue('data:image/png;base64,x');
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    const input = document.createElement('input');
    document.body.appendChild(input);
    await act(async () => { keydownV(input); });
    expect(clipboard.readImageFromClipboard).not.toHaveBeenCalled();
    input.remove();
  });

  it('⌥⌘V (kèm Alt) không phải tổ hợp dán — bị bỏ qua', async () => {
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    await act(async () => { keydownV(document.body, { altKey: true }); });
    expect(clipboard.readImageFromClipboard).not.toHaveBeenCalled();
  });

  it('bấm phím Ctrl+V (Windows/Linux) cũng kích hoạt, không chỉ ⌘', async () => {
    vi.mocked(clipboard.readImageFromClipboard).mockResolvedValue('data:image/png;base64,x');
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    await act(async () => { keydownV(document.body, { metaKey: false, ctrlKey: true }); });
    expect(onImage).toHaveBeenCalled();
  });

  it('gỡ handler cũ dùng bản onImage MỚI NHẤT khi callback đổi giữa các lần render', async () => {
    vi.mocked(clipboard.readImageFromClipboard).mockResolvedValue('data:image/png;base64,x');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useImagePaste(cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    await act(async () => { keydownV(document.body); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unmount gỡ listener — ⌘V sau đó không còn gọi readImageFromClipboard', async () => {
    const onImage = vi.fn();
    const { unmount } = renderHook(() => useImagePaste(onImage));
    unmount();
    await act(async () => { keydownV(document.body); });
    expect(clipboard.readImageFromClipboard).not.toHaveBeenCalled();
  });
});

describe('useImagePaste — sự kiện paste gốc (kèm file ảnh, ưu tiên hơn đọc clipboard qua API)', () => {
  beforeEach(() => { vi.mocked(clipboard.readImageFromClipboard).mockReset(); });

  it('paste có item ảnh → đọc thành data URL rồi gọi onImage', async () => {
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    const file = new File(['png-bytes'], 'x.png', { type: 'image/png' });
    // `FileReader.readAsDataURL` xong việc qua callback `onload` CỦA RIÊNG NÓ
    // (một macrotask, không phải Promise) — dispatch sự kiện xong không có gì
    // để `await` trực tiếp, nên phải chờ bằng `vi.waitFor`.
    act(() => { pasteWithImage(file); });
    await vi.waitFor(() => expect(onImage).toHaveBeenCalledTimes(1));
    expect(String(onImage.mock.calls[0][0])).toMatch(/^data:image\/png;base64,/);
  });

  it('paste không có item nào, hoặc không có item ảnh → không gọi onImage', async () => {
    const onImage = vi.fn();
    renderHook(() => useImagePaste(onImage));
    await act(async () => { pasteWithImage(null); });
    expect(onImage).not.toHaveBeenCalled();
  });

  it('hai lần capture trong vòng 500ms (vd cả keydown lẫn paste cùng bắn cho một ⌘V) chỉ gọi onImage MỘT LẦN', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.mocked(clipboard.readImageFromClipboard).mockResolvedValue('data:image/png;base64,x');
      const onImage = vi.fn();
      renderHook(() => useImagePaste(onImage));
      await act(async () => { keydownV(document.body); });
      vi.advanceTimersByTime(100); // vẫn trong cửa sổ 500ms
      const file = new File(['png-bytes'], 'x.png', { type: 'image/png' });
      await act(async () => { pasteWithImage(file); });
      expect(onImage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
