import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDismissable } from '@/hooks/useDismissable';

/** Chưa có test nào — nền tảng dismiss-on-outside-click/Escape dùng chung bởi
 *  ColorPicker/DatePicker/TimePicker (qua `useAnimatedOpen`) và các popover khác. */

function firePointerDown(target: Node) {
  const el = target as HTMLElement;
  const evt = new Event('pointerdown', { bubbles: true }) as PointerEvent;
  Object.defineProperty(evt, 'target', { value: el });
  window.dispatchEvent(evt);
}

describe('useDismissable', () => {
  it('active=false: không gắn listener nào — click ngoài hay Escape đều không gọi onDismiss', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDismissable<HTMLDivElement>(false, onDismiss));
    result.current.current = document.createElement('div');
    firePointerDown(document.body);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('click NGOÀI phần tử đã gắn ref → gọi onDismiss', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDismissable<HTMLDivElement>(true, onDismiss));
    const el = document.createElement('div');
    document.body.appendChild(el);
    result.current.current = el;

    const outside = document.createElement('span');
    document.body.appendChild(outside);
    firePointerDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    el.remove(); outside.remove();
  });

  it('click BÊN TRONG (hoặc trên chính) phần tử đã gắn ref → KHÔNG gọi onDismiss', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDismissable<HTMLDivElement>(true, onDismiss));
    const el = document.createElement('div');
    const child = document.createElement('button');
    el.appendChild(child);
    document.body.appendChild(el);
    result.current.current = el;

    firePointerDown(child); // click vào phần tử con
    firePointerDown(el);    // click ngay trên chính nó
    expect(onDismiss).not.toHaveBeenCalled();

    el.remove();
  });

  it('phím Escape gọi onDismiss bất kể vị trí click gần nhất, không kiểm tra containment', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDismissable<HTMLDivElement>(true, onDismiss));
    result.current.current = document.createElement('div');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('phím khác Escape không kích hoạt gì', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDismissable<HTMLDivElement>(true, onDismiss));
    result.current.current = document.createElement('div');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('onDismiss đổi giữa các lần render (không toggle active) vẫn dùng bản MỚI NHẤT, không phải closure cũ', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useDismissable<HTMLDivElement>(true, cb),
      { initialProps: { cb: first } },
    );
    result.current.current = document.createElement('div');
    rerender({ cb: second });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unmount gỡ listener — sự kiện sau đó không còn gọi onDismiss', () => {
    const onDismiss = vi.fn();
    const { result, unmount } = renderHook(() => useDismissable<HTMLDivElement>(true, onDismiss));
    result.current.current = document.createElement('div');
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('active chuyển từ false → true: bắt đầu lắng nghe kể từ đó', () => {
    const onDismiss = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useDismissable<HTMLDivElement>(active, onDismiss),
      { initialProps: { active: false } },
    );
    result.current.current = document.createElement('div');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();

    rerender({ active: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
