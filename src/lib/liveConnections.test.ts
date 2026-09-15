import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Registry toàn cục cho "tool nào đang có kết nối live" (chấm xanh trên
 * sidebar). Không còn bước seed lúc module nạp — xem file-level comment của
 * liveConnections.ts cho lý do (mọi tool từng seed ở đây giờ là plugin cài
 * từ bên ngoài).
 */

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('liveConnections.set / useLiveConnections — hành vi runtime', () => {
  it('bật một featureId → useLiveConnections() phản ánh ngay, tắt lại → biến mất', async () => {
    const { liveConnections, useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    expect(result.current).toEqual([]);

    act(() => liveConnections.set('kafka-explorer', true));
    expect(result.current).toEqual(['kafka-explorer']);

    act(() => liveConnections.set('kafka-explorer', false));
    expect(result.current).toEqual([]);
  });

  it('nhiều featureId độc lập — tắt cái này không đụng cái khác', async () => {
    const { liveConnections, useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    act(() => {
      liveConnections.set('kafka-explorer', true);
      liveConnections.set('rabbit-client', true);
    });
    expect(new Set(result.current)).toEqual(new Set(['kafka-explorer', 'rabbit-client']));

    act(() => liveConnections.set('kafka-explorer', false));
    expect(result.current).toEqual(['rabbit-client']);
  });

  it('set() với đúng trạng thái hiện tại là no-op — không phát sinh thông báo cho subscriber', async () => {
    const { liveConnections, useLiveConnections } = await import('@/lib/liveConnections');
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useLiveConnections(); });
    const base = renders;

    act(() => liveConnections.set('kafka-explorer', false)); // đã là false từ đầu
    expect(renders).toBe(base); // không re-render vì snapshot không đổi
    expect(result.current).toEqual([]);
  });

  it('nhiều subscriber (nhiều renderHook) đều nhận cùng một thay đổi', async () => {
    const { liveConnections, useLiveConnections } = await import('@/lib/liveConnections');
    const a = renderHook(() => useLiveConnections());
    const b = renderHook(() => useLiveConnections());
    act(() => liveConnections.set('redis-client', true));
    expect(a.result.current).toEqual(['redis-client']);
    expect(b.result.current).toEqual(['redis-client']);
  });
});
