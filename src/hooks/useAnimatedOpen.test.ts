import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimatedOpen } from '@/hooks/useAnimatedOpen';

/**
 * `ColorPicker` / `DatePicker` / `TimePicker` popover từng render kiểu
 * `{open && <div>}` với KHÔNG animation nào — không vào, không ra. Hook này
 * là bản sửa dùng chung; test khoá đúng phần dễ hỏng nhất: `visible` phải
 * còn `true` suốt lúc `closing`, để panel có thời gian chạy animation ra
 * trước khi thật sự biến mất khỏi DOM.
 */
describe('useAnimatedOpen', () => {
  it('visible ở lại true trong lúc closing, rồi tắt sau --dur-exit', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnimatedOpen());

    act(() => result.current.show());
    expect(result.current).toMatchObject({ open: true, closing: false, visible: true });

    act(() => result.current.close());
    // Đóng xong: `open` đã tắt (dismiss/focus logic dừng ngay), nhưng
    // `visible` còn true để panel còn render và chạy animation ra.
    expect(result.current).toMatchObject({ open: false, closing: true, visible: true });

    act(() => { vi.advanceTimersByTime(130); });
    expect(result.current).toMatchObject({ open: false, closing: false, visible: false });
    vi.useRealTimers();
  });

  it('mở lại giữa lúc đang closing thì huỷ animation ra dở dang', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnimatedOpen());
    act(() => result.current.show());
    act(() => result.current.close());
    expect(result.current.closing).toBe(true);

    act(() => result.current.show());
    expect(result.current).toMatchObject({ open: true, closing: false, visible: true });

    // Timer cũ không được bắn ra và tắt state của lượt mở mới.
    act(() => { vi.advanceTimersByTime(130); });
    expect(result.current).toMatchObject({ open: true, closing: false, visible: true });
    vi.useRealTimers();
  });

  it('close() khi đang đóng sẵn là vô hại, không khởi động lại animation', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnimatedOpen());
    expect(result.current).toMatchObject({ open: false, closing: false, visible: false });
    act(() => result.current.close());
    expect(result.current).toMatchObject({ open: false, closing: false, visible: false });
    vi.useRealTimers();
  });

  it('toggle() đi qua đúng show()/close() theo trạng thái hiện tại', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnimatedOpen());
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ open: false, closing: true });
    vi.useRealTimers();
  });
});
