import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimatedOpen } from '@/hooks/useAnimatedOpen';

/**
 * `visible` must stay true while `closing`, so the panel can play its exit
 * animation before leaving the DOM.
 */
describe('useAnimatedOpen', () => {
  it('visible ở lại true trong lúc closing, rồi tắt sau --dur-exit', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnimatedOpen());

    act(() => result.current.show());
    expect(result.current).toMatchObject({ open: true, closing: false, visible: true });

    act(() => result.current.close());
    // `open` is off (dismiss and focus logic stop), but `visible` stays true
    // for the exit animation.
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

    // The old timer must not close the new open.
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
