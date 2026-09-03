import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
// KHÔNG import tĩnh `storageSet` ở đây — mỗi test seed phải lấy nó từ CÙNG
// một lần nạp module (sau `vi.resetModules()`) mà `liveConnections.ts` dùng,
// nếu không giá trị ghi vào sẽ nằm trên một bản cache module cũ, bị nạp lại
// module xoá mất trước khi `liveConnections.ts` kịp đọc.

/**
 * Registry toàn cục cho "tool nào đang có kết nối live" (chấm xanh trên
 * sidebar). Có bước SEED lúc module nạp (đọc từ persistentStore, để chấm
 * đúng ngay lần mở app đầu tiên, trước khi tool tự mount) — nên test seed
 * phải nạp module MỚI sau khi đặt sẵn dữ liệu, qua `vi.resetModules()`.
 * Chưa có test nào trước đây.
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

describe('liveConnections — seed lúc module nạp (chấm đúng ngay lần mở app đầu tiên)', () => {
  it('có id kết nối đã lưu trong storage → seed sẵn thành "live" trước khi tool nào mount', async () => {
    vi.resetModules();
    const { storageSet } = await import('@/lib/persistentStore');
    storageSet('devtool:kafka:connectedBrokerId', JSON.stringify('broker-1'));
    const { useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    expect(result.current).toEqual(['kafka-explorer']);
  });

  it('cả ba tool (rabbit/kafka/redis) đều được seed độc lập từ đúng key của mình', async () => {
    vi.resetModules();
    const { storageSet } = await import('@/lib/persistentStore');
    storageSet('devtool:rabbit:connectedConnId', JSON.stringify('conn-1'));
    storageSet('devtool:redis:connectedConnId', JSON.stringify('conn-2'));
    const { useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    expect(new Set(result.current)).toEqual(new Set(['rabbit-client', 'redis-client']));
  });

  it('chuỗi rỗng đã lưu ("chưa từng kết nối") KHÔNG được seed thành live', async () => {
    vi.resetModules();
    const { storageSet } = await import('@/lib/persistentStore');
    storageSet('devtool:kafka:connectedBrokerId', JSON.stringify(''));
    const { useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    expect(result.current).toEqual([]);
  });

  it('dữ liệu JSON hỏng trong storage bị bỏ qua trong im lặng, không làm module nạp thất bại', async () => {
    vi.resetModules();
    const { storageSet } = await import('@/lib/persistentStore');
    storageSet('devtool:kafka:connectedBrokerId', 'not-valid-json{{{');
    await expect(import('@/lib/liveConnections')).resolves.toBeDefined();
    const { useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    expect(result.current).toEqual([]);
  });

  it('không có gì trong storage → seed rỗng, không tool nào live lúc khởi động', async () => {
    vi.resetModules();
    const { useLiveConnections } = await import('@/lib/liveConnections');
    const { result } = renderHook(() => useLiveConnections());
    expect(result.current).toEqual([]);
  });
});
