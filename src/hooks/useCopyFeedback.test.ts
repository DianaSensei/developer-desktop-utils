import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';
import * as clipboard from '@/lib/clipboard';

/** Chưa có test nào — dùng bởi `CopyButton.tsx` cho hiệu ứng "vừa copy xong". */

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn() }));

describe('useCopyFeedback', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(clipboard.copyToClipboard).mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('copy() thành công → copied bật lên true, rồi tự tắt sau timeout', async () => {
    vi.mocked(clipboard.copyToClipboard).mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyFeedback(2000));
    expect(result.current.copied).toBe(false);

    await act(async () => { await result.current.copy('hello'); });
    expect(result.current.copied).toBe(true);
    expect(clipboard.copyToClipboard).toHaveBeenCalledWith('hello');

    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current.copied).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.copied).toBe(false);
  });

  it('copy() thất bại (clipboard từ chối quyền) thì copied vẫn false, không throw', async () => {
    vi.mocked(clipboard.copyToClipboard).mockRejectedValue(new Error('denied'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCopyFeedback());
    await act(async () => { await result.current.copy('x'); });
    expect(result.current.copied).toBe(false);
    errSpy.mockRestore();
  });

  it('copy() liên tiếp: lần gọi sau đặt lại đồng hồ, không tắt sớm theo lần gọi trước', async () => {
    vi.mocked(clipboard.copyToClipboard).mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyFeedback(1000));
    await act(async () => { await result.current.copy('a'); });
    act(() => { vi.advanceTimersByTime(600); });
    // Copy lần 2 trước khi timer lần 1 kịp bắn — phải huỷ timer cũ, không để
    // nó tắt `copied` giữa chừng lần 2.
    await act(async () => { await result.current.copy('b'); });
    act(() => { vi.advanceTimersByTime(600); }); // tổng 1200ms kể từ lần 1, nhưng chỉ 600ms kể từ lần 2
    expect(result.current.copied).toBe(true);
    act(() => { vi.advanceTimersByTime(400); }); // đủ 1000ms kể từ lần 2
    expect(result.current.copied).toBe(false);
  });

  it('unmount trong lúc timer đang chờ không gây lỗi setState-after-unmount', async () => {
    vi.mocked(clipboard.copyToClipboard).mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useCopyFeedback(1000));
    await act(async () => { await result.current.copy('x'); });
    unmount();
    expect(() => { act(() => { vi.advanceTimersByTime(2000); }); }).not.toThrow();
  });
});
