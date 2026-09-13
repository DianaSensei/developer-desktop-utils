// Regression coverage for the drag/drop reorder bug: hovering a folder row
// always forced `where: 'inside'` (see onDragOver in Sidebar.tsx), so a
// request/folder could never land BEFORE or AFTER a folder as a sibling — it
// always got nested into it instead. store.moveItem already supported
// before/after with a folder target; the bug was purely in the UI's zone
// computation, so this test drives the real onDragOver/onDrop handlers
// through the DOM rather than calling the store directly.

import { act, renderHook, render, fireEvent } from '@testing-library/react';
import { createEvent } from '@testing-library/dom';
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
});

// jsdom doesn't implement scrollIntoView; RequestNode's Row calls it whenever
// the active request mounts (see the `active` effect in Sidebar.tsx).
Element.prototype.scrollIntoView = vi.fn();

// jsdom leaves getBoundingClientRect at all-zeros; stub it per-row so the
// onDragOver handler's `(clientY - top) / height` zone math is meaningful.
function stubRect(el: Element, top: number, height: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}),
  });
}

// jsdom has no DragEvent constructor, so @testing-library/dom's fireEvent
// falls back to a plain Event for drag* event names — `clientY`/`altKey`
// passed in the init dict are silently dropped (Event's constructor doesn't
// recognize them). Build the event via createEvent (still gets the
// dataTransfer shim) and assign the extra properties directly afterward,
// which a plain Event object accepts fine.
function fireDrag(name: 'dragStart' | 'dragOver' | 'drop', node: HTMLElement, clientY: number, altKey = false) {
  const event = createEvent[name](node, { dataTransfer: { dropEffect: '', effectAllowed: '' } });
  Object.assign(event, { clientY, altKey });
  return fireEvent(node, event);
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

    const gammaRow = getByText('Gamma').closest('[draggable]') as HTMLElement;
    const betaRow = getByText('Beta').closest('[draggable]') as HTMLElement;
    expect(gammaRow).toBeTruthy();
    expect(betaRow).toBeTruthy();

    stubRect(betaRow, 100, 28); // top quarter: clientY < 100 + 7

    fireDrag('dragStart', gammaRow, 0);
    fireDrag('dragOver', betaRow, 103);
    fireDrag('drop', betaRow, 103);

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

    const gammaRow = getByText('Gamma').closest('[draggable]') as HTMLElement;
    const alphaRow = getByText('Alpha').closest('[draggable]') as HTMLElement;

    stubRect(alphaRow, 100, 28); // bottom quarter: clientY > 100 + 21

    fireDrag('dragStart', gammaRow, 0);
    fireDrag('dragOver', alphaRow, 125);
    fireDrag('drop', alphaRow, 125);

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

    const gammaRow = getByText('Gamma').closest('[draggable]') as HTMLElement;
    const alphaRow = getByText('Alpha').closest('[draggable]') as HTMLElement;

    stubRect(alphaRow, 100, 28); // middle band: 100+7 <= clientY <= 100+21

    fireDrag('dragStart', gammaRow, 0);
    fireDrag('dragOver', alphaRow, 114);
    fireDrag('drop', alphaRow, 114);

    const collection = result.current.collections.find((c) => c.id === collectionId)!;
    expect(collection.items).toHaveLength(1);
    const alpha = collection.items[0];
    expect(alpha.id).toBe(alphaId);
    expect(alpha.type).toBe('folder');
    if (alpha.type === 'folder') expect(alpha.items.map((i) => i.id)).toEqual([gammaId]);
  });
});
