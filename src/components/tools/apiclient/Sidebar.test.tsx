// Regression coverage for drag/drop reorder in the Sidebar tree.
//
// This used to be built on native HTML5 draggable/dragstart/dragover/drop.
// That never actually fired in the real desktop app: Tauri's window has
// `dragDropEnabled` on (its default, needed for OS-level file drops — see
// useTauriFileDrop.ts, used by ChecksumTool/QRCodeTool/ImageBase64Tool) and
// intercepts every native drag gesture before the webview sees it. It only
// ever worked in a plain browser tab, which is why earlier tests here (and
// manual verification in a browser) reported success while the real app
// stayed broken. Sidebar.tsx now drives reordering off plain pointer events
// instead — this file exercises that.

import { act, renderHook, render, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

const cache = new Map<string, string>();

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (cache.has(k) ? cache.get(k)! : null),
  storageSet: (k: string, v: string) => { cache.set(k, v); },
  flushPersistentStore: () => Promise.resolve(),
}));

beforeEach(() => {
  cache.clear();
  vi.restoreAllMocks();
});

// jsdom doesn't implement scrollIntoView; RequestNode's Row calls it whenever
// the active request mounts (see the `active` effect in Sidebar.tsx).
Element.prototype.scrollIntoView = vi.fn();

// jsdom leaves getBoundingClientRect at all-zeros; stub it per-row so
// findDropTarget's `(clientY - top) / height` zone math is meaningful.
function stubRect(el: Element, top: number, height: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}),
  });
}

// jsdom's `elementFromPoint` doesn't do real layout — it always returns
// null. findDropTarget uses it to hit-test the pointer position during a
// drag, so tests stand in for the browser's real hit-testing by stubbing it
// to return whichever row the test is actually dragging over.
function stubElementFromPoint(row: Element) {
  // jsdom doesn't define `elementFromPoint` at all (not even as a stub
  // returning null), so `vi.spyOn` has nothing to wrap — assign it directly.
  document.elementFromPoint = vi.fn(() => row);
}

// jsdom's PointerEvent constructor doesn't carry clientX/clientY/altKey
// through its init dict the way a real browser's does — assign them
// directly on the constructed event, same workaround as the old DragEvent
// tests needed.
function firePointer(
  name: 'pointerdown' | 'pointermove' | 'pointerup',
  node: HTMLElement,
  clientY: number,
  opts: { altKey?: boolean; button?: number } = {},
) {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 0, clientY, altKey: opts.altKey ?? false, button: opts.button ?? 0, pointerId: 1 });
  return fireEvent(node, event);
}

// A drag: pointerdown on `source`, then pointermove past the drag threshold
// (jumping straight from clientY 0 to `overY`, stubbing `elementFromPoint`
// to report `over` as whatever's under the cursor there), then pointerup.
function drag(source: HTMLElement, over: HTMLElement, overY: number, altKey = false) {
  stubElementFromPoint(over);
  firePointer('pointerdown', source, 0);
  firePointer('pointermove', source, overY, { altKey });
  firePointer('pointerup', source, overY);
}

describe('Sidebar — drag/drop reorder around a folder', () => {
  it('drops a request BEFORE a folder when released in the row\'s top quarter', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let collectionId = '';
    act(() => { collectionId = result.current.addCollection(); });
    let alphaId = '';
    let betaId = '';
    let gammaId = '';
    act(() => { alphaId = result.current.addItem(collectionId, 'folder'); });
    act(() => { betaId = result.current.addItem(collectionId, 'folder'); });
    act(() => { gammaId = result.current.addItem(collectionId, 'request'); });
    act(() => { result.current.renameItem(alphaId, 'Alpha'); });
    act(() => { result.current.renameItem(betaId, 'Beta'); });
    act(() => { result.current.renameItem(gammaId, 'Gamma'); });

    const { getByText } = render(<Sidebar store={result.current} onRun={() => {}} />);

    const gammaRow = getByText('Gamma').closest('[data-tree-row]') as HTMLElement;
    const betaRow = getByText('Beta').closest('[data-tree-row]') as HTMLElement;
    expect(gammaRow).toBeTruthy();
    expect(betaRow).toBeTruthy();

    stubRect(betaRow, 100, 28); // top quarter: clientY < 100 + 7

    drag(gammaRow, betaRow, 103);

    const ids = result.current.collections.find((c) => c.id === collectionId)!.items.map((i) => i.id);
    expect(ids).toEqual([alphaId, gammaId, betaId]);
  });

  it('drops a request AFTER a folder when released in the row\'s bottom quarter', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let collectionId = '';
    act(() => { collectionId = result.current.addCollection(); });
    let alphaId = '';
    let gammaId = '';
    act(() => { alphaId = result.current.addItem(collectionId, 'folder'); });
    act(() => { gammaId = result.current.addItem(collectionId, 'request'); });
    act(() => { result.current.renameItem(alphaId, 'Alpha'); });
    act(() => { result.current.renameItem(gammaId, 'Gamma'); });

    const { getByText } = render(<Sidebar store={result.current} onRun={() => {}} />);

    const gammaRow = getByText('Gamma').closest('[data-tree-row]') as HTMLElement;
    const alphaRow = getByText('Alpha').closest('[data-tree-row]') as HTMLElement;

    stubRect(alphaRow, 100, 28); // bottom quarter: clientY > 100 + 21

    drag(gammaRow, alphaRow, 125);

    const ids = result.current.collections.find((c) => c.id === collectionId)!.items.map((i) => i.id);
    expect(ids).toEqual([alphaId, gammaId]);
  });

  it('still nests a request INSIDE a folder when released in the middle band', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let collectionId = '';
    act(() => { collectionId = result.current.addCollection(); });
    let alphaId = '';
    let gammaId = '';
    act(() => { alphaId = result.current.addItem(collectionId, 'folder'); });
    act(() => { gammaId = result.current.addItem(collectionId, 'request'); });
    act(() => { result.current.renameItem(alphaId, 'Alpha'); });
    act(() => { result.current.renameItem(gammaId, 'Gamma'); });

    const { getByText } = render(<Sidebar store={result.current} onRun={() => {}} />);

    const gammaRow = getByText('Gamma').closest('[data-tree-row]') as HTMLElement;
    const alphaRow = getByText('Alpha').closest('[data-tree-row]') as HTMLElement;

    stubRect(alphaRow, 100, 28); // middle band: 100+7 <= clientY <= 100+21

    drag(gammaRow, alphaRow, 114);

    const collection = result.current.collections.find((c) => c.id === collectionId)!;
    expect(collection.items).toHaveLength(1);
    const alpha = collection.items[0];
    expect(alpha.id).toBe(alphaId);
    expect(alpha.type).toBe('folder');
    if (alpha.type === 'folder') expect(alpha.items.map((i) => i.id)).toEqual([gammaId]);
  });

  it('does not start a drag from a plain click that never moves past the threshold', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let collectionId = '';
    act(() => { collectionId = result.current.addCollection(); });
    let alphaId = '';
    let gammaId = '';
    act(() => { alphaId = result.current.addItem(collectionId, 'folder'); });
    act(() => { gammaId = result.current.addItem(collectionId, 'request'); });
    act(() => { result.current.renameItem(alphaId, 'Alpha'); });
    act(() => { result.current.renameItem(gammaId, 'Gamma'); });

    const { getByText } = render(<Sidebar store={result.current} onRun={() => {}} />);
    const gammaRow = getByText('Gamma').closest('[data-tree-row]') as HTMLElement;
    const alphaRow = getByText('Alpha').closest('[data-tree-row]') as HTMLElement;
    stubRect(alphaRow, 100, 28);
    stubElementFromPoint(alphaRow);

    firePointer('pointerdown', gammaRow, 0);
    // Movement stays within the 4px threshold — never becomes a drag.
    firePointer('pointermove', gammaRow, 2);
    firePointer('pointerup', gammaRow, 2);

    const collection = result.current.collections.find((c) => c.id === collectionId)!;
    expect(collection.items.map((i) => i.id)).toEqual([alphaId, gammaId]);
  });

  it('copies instead of moves when Alt/Option is held', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let sourceCollectionId = '';
    let targetCollectionId = '';
    act(() => { sourceCollectionId = result.current.addCollection(); });
    act(() => { targetCollectionId = result.current.addCollection(); });
    let gammaId = '';
    act(() => { gammaId = result.current.addItem(sourceCollectionId, 'request'); });
    act(() => { result.current.renameItem(gammaId, 'Gamma'); });
    act(() => { result.current.renameCollection(targetCollectionId, 'Target'); });

    const { getByText } = render(<Sidebar store={result.current} onRun={() => {}} />);
    const gammaRow = getByText('Gamma').closest('[data-tree-row]') as HTMLElement;
    const targetRow = getByText('Target').closest('[data-tree-row]') as HTMLElement;
    stubRect(targetRow, 100, 28);

    drag(gammaRow, targetRow, 114, true);

    const source = result.current.collections.find((c) => c.id === sourceCollectionId)!;
    const target = result.current.collections.find((c) => c.id === targetCollectionId)!;
    // Alt held: the original stays in place, a copy lands in the target.
    expect(source.items.map((i) => i.id)).toEqual([gammaId]);
    expect(target.items).toHaveLength(1);
    expect(target.items[0].id).not.toBe(gammaId);
  });
});

describe('Sidebar — revealTick (tab bar\'s "reveal in sidebar" button)', () => {
  it('re-scrolls the active row into view when revealTick changes, even though activeRequestId does not', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    let collectionId = '';
    act(() => { collectionId = result.current.addCollection(); });
    // addItem(..., 'request') selects it — this becomes store.activeRequestId.
    act(() => { result.current.addItem(collectionId, 'request'); });

    const { rerender, getByText } = render(<Sidebar store={result.current} onRun={() => {}} revealTick={0} />);
    const activeRow = getByText('New Request').closest('[data-tree-row]') as HTMLElement;
    expect(activeRow).toBeTruthy();

    const scrollSpy = vi.mocked(activeRow.scrollIntoView);
    scrollSpy.mockClear();

    // Same store, same activeRequestId — only revealTick moves.
    rerender(<Sidebar store={result.current} onRun={() => {}} revealTick={1} />);

    expect(scrollSpy).toHaveBeenCalled();
  });
});
