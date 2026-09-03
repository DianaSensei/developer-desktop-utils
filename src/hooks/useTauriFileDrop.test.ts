import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * `isTauri` (từ `@/lib/platform`) là hằng số tính MỘT LẦN lúc module nạp, dựa
 * trên `'__TAURI_INTERNALS__' in window` — nên để test được nhánh Tauri thật
 * (toàn bộ logic hit-test vị trí thả file + gọi callback), phải đặt
 * `window.__TAURI_INTERNALS__` TRƯỚC KHI import, rồi `vi.resetModules()` để
 * buộc nạp lại `platform.ts` với giá trị mới. Không làm vậy thì `isTauri`
 * luôn `false` trong jsdom và toàn bộ effect return sớm — không test được gì
 * ngoài phần vỏ (chưa có test nào trước đây, kể cả phần vỏ đó).
 */

const onDragDropEvent = vi.fn();
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

type DragDropCallback = (event: { payload: { type: string; paths?: string[]; position?: { x: number; y: number } } }) => void;

async function renderWithTauri(onDropPaths: (paths: string[]) => void, enabled = true) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { useTauriFileDrop } = await import('@/hooks/useTauriFileDrop');
  const view = renderHook(() => useTauriFileDrop(onDropPaths, enabled));
  return view;
}

describe('useTauriFileDrop — nền Tauri desktop (window.__TAURI_INTERNALS__ có mặt)', () => {
  let capturedCb: DragDropCallback | undefined;

  beforeEach(() => {
    onDragDropEvent.mockReset();
    unlisten.mockReset();
    capturedCb = undefined;
    onDragDropEvent.mockImplementation((cb: DragDropCallback) => {
      capturedCb = cb;
      return Promise.resolve(unlisten);
    });
  });
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  function stubRect(el: HTMLElement, rect: { left: number; right: number; top: number; bottom: number }) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top, toJSON() { return this; },
    });
  }

  it('gắn listener qua getCurrentWebview().onDragDropEvent, và isTauri trả về true', async () => {
    const { result } = await renderWithTauri(vi.fn());
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalledTimes(1));
    expect(result.current.isTauri).toBe(true);
  });

  it('enabled=false: không gọi getCurrentWebview dù đang ở nền Tauri', async () => {
    await renderWithTauri(vi.fn(), false);
    await new Promise((r) => setTimeout(r, 0));
    expect(onDragDropEvent).not.toHaveBeenCalled();
  });

  it('"enter"/"over" TRONG vùng ref → dragging=true; NGOÀI vùng → dragging=false', async () => {
    const { result } = await renderWithTauri(vi.fn());
    await waitFor(() => expect(capturedCb).toBeDefined());
    const el = document.createElement('div');
    stubRect(el, { left: 0, right: 100, top: 0, bottom: 100 });
    result.current.dropRef.current = el;

    act(() => capturedCb!({ payload: { type: 'enter', position: { x: 50, y: 50 } } }));
    expect(result.current.dragging).toBe(true);

    act(() => capturedCb!({ payload: { type: 'over', position: { x: 500, y: 500 } } }));
    expect(result.current.dragging).toBe(false);
  });

  it('"drop" TRONG vùng, có paths → gọi onDropPaths và tắt dragging', async () => {
    const onDropPaths = vi.fn();
    const { result } = await renderWithTauri(onDropPaths);
    await waitFor(() => expect(capturedCb).toBeDefined());
    const el = document.createElement('div');
    stubRect(el, { left: 0, right: 100, top: 0, bottom: 100 });
    result.current.dropRef.current = el;

    act(() => capturedCb!({ payload: { type: 'drop', position: { x: 10, y: 10 }, paths: ['/a/b.png'] } }));
    expect(onDropPaths).toHaveBeenCalledWith(['/a/b.png']);
    expect(result.current.dragging).toBe(false);
  });

  it('"drop" NGOÀI vùng thì KHÔNG gọi onDropPaths, dù có paths', async () => {
    const onDropPaths = vi.fn();
    const { result } = await renderWithTauri(onDropPaths);
    await waitFor(() => expect(capturedCb).toBeDefined());
    const el = document.createElement('div');
    stubRect(el, { left: 0, right: 100, top: 0, bottom: 100 });
    result.current.dropRef.current = el;

    act(() => capturedCb!({ payload: { type: 'drop', position: { x: 999, y: 999 }, paths: ['/a/b.png'] } }));
    expect(onDropPaths).not.toHaveBeenCalled();
  });

  it('"drop" trong vùng nhưng KHÔNG kèm paths (mảng rỗng/undefined) thì không gọi onDropPaths', async () => {
    const onDropPaths = vi.fn();
    const { result } = await renderWithTauri(onDropPaths);
    await waitFor(() => expect(capturedCb).toBeDefined());
    const el = document.createElement('div');
    stubRect(el, { left: 0, right: 100, top: 0, bottom: 100 });
    result.current.dropRef.current = el;

    act(() => capturedCb!({ payload: { type: 'drop', position: { x: 10, y: 10 }, paths: [] } }));
    expect(onDropPaths).not.toHaveBeenCalled();
  });

  it('"leave" tắt dragging', async () => {
    const { result } = await renderWithTauri(vi.fn());
    await waitFor(() => expect(capturedCb).toBeDefined());
    const el = document.createElement('div');
    stubRect(el, { left: 0, right: 100, top: 0, bottom: 100 });
    result.current.dropRef.current = el;

    act(() => capturedCb!({ payload: { type: 'enter', position: { x: 10, y: 10 } } }));
    expect(result.current.dragging).toBe(true);
    act(() => capturedCb!({ payload: { type: 'leave' } }));
    expect(result.current.dragging).toBe(false);
  });

  it('không có dropRef.current (chưa gắn phần tử nào) thì mọi vị trí đều coi là "ngoài vùng"', async () => {
    const onDropPaths = vi.fn();
    const { result } = await renderWithTauri(onDropPaths);
    await waitFor(() => expect(capturedCb).toBeDefined());
    act(() => capturedCb!({ payload: { type: 'drop', position: { x: 10, y: 10 }, paths: ['/a'] } }));
    expect(onDropPaths).not.toHaveBeenCalled();
    expect(result.current.dragging).toBe(false);
  });

  it('unmount gọi hàm unlisten và đặt lại dragging=false', async () => {
    const { result, unmount } = await renderWithTauri(vi.fn());
    await waitFor(() => expect(capturedCb).toBeDefined());
    const el = document.createElement('div');
    stubRect(el, { left: 0, right: 100, top: 0, bottom: 100 });
    result.current.dropRef.current = el;
    act(() => capturedCb!({ payload: { type: 'enter', position: { x: 10, y: 10 } } }));
    expect(result.current.dragging).toBe(true);

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('unmount TRƯỚC KHI getCurrentWebview().onDragDropEvent kịp resolve vẫn gọi unlisten ngay khi nó xong — không rò rỉ listener', async () => {
    let resolve!: (fn: () => void) => void;
    onDragDropEvent.mockImplementation((cb: DragDropCallback) => {
      capturedCb = cb;
      return new Promise<() => void>((r) => { resolve = r; });
    });
    vi.resetModules();
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    const { useTauriFileDrop } = await import('@/hooks/useTauriFileDrop');
    const { unmount } = renderHook(() => useTauriFileDrop(vi.fn()));

    // Đợi tới đúng khoảnh khắc `onDragDropEvent` đã được GỌI (nên `resolve` đã
    // có giá trị) nhưng promise nó trả về CHƯA resolve — đúng cửa sổ race mà
    // cờ `cancelled` trong nguồn phải xử lý.
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalledTimes(1));
    unmount(); // huỷ trong lúc promise còn treo
    act(() => resolve(unlisten));
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});

describe('useTauriFileDrop — nền web (không có __TAURI_INTERNALS__)', () => {
  it('isTauri=false, không đụng gì tới getCurrentWebview dù enabled=true', async () => {
    onDragDropEvent.mockReset();
    vi.resetModules();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { useTauriFileDrop } = await import('@/hooks/useTauriFileDrop');
    const { result } = renderHook(() => useTauriFileDrop(vi.fn()));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toMatchObject({ dragging: false, isTauri: false });
    expect(onDragDropEvent).not.toHaveBeenCalled();
  });
});
