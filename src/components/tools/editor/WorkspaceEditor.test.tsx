import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { WorkspaceEditor } from './WorkspaceEditor';
import { getEditorStore, resetEditorSession } from './session';
import { getPluginSdk } from '@/platform';
import { storageKeys, storageRemove } from '@/lib/persistentStore';

// The browser build (no Tauri) runs on the seeded in-memory workspace, which
// is what jsdom gets here — so this drives the real component end to end.

// jsdom doesn't implement scrollIntoView; the tree and tab strip call it to
// keep the active row/tab in view.
Element.prototype.scrollIntoView = vi.fn();
// …nor Range geometry, which the snapshot diff view measures.
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function renderEditor() {
  return render(
    <AppConfigProvider>
      <WorkspaceEditor />
    </AppConfigProvider>,
  );
}

beforeEach(() => {
  // Flushes the previous session's pending writes, then wipes them, so each
  // test starts from a fresh install.
  resetEditorSession();
  for (const key of storageKeys()) if (key.startsWith('devtool:text-editor:')) storageRemove(key);
});
afterEach(() => cleanup());

describe('WorkspaceEditor (browser demo workspace)', () => {
  it('says it is a demo and offers to open a folder', async () => {
    renderEditor();
    expect(screen.getByText(/Browser preview/)).toBeTruthy();
    expect(await screen.findByText('No folder opened')).toBeTruthy();
  });

  it('opens the demo folder from Recent, then a file into a tab', async () => {
    renderEditor();
    fireEvent.click(await screen.findByTitle('/demo-workspace'));
    const readme = await screen.findByText('README.md');
    await act(async () => { fireEvent.click(readme); });
    await waitFor(() => expect(screen.getByRole('tab', { name: /README\.md/ })).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Ln 1, Col 1/)).toBeTruthy());
  });

  it('creates a file through the inline name field', async () => {
    renderEditor();
    fireEvent.click(await screen.findByTitle('/demo-workspace'));
    await screen.findByText('README.md');
    fireEvent.click(screen.getByRole('button', { name: 'New File…' }));
    const field = await screen.findByPlaceholderText(/File name/);
    fireEvent.change(field, { target: { value: 'notes/todo.md' } });
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); });
    await waitFor(() => expect(screen.getByRole('tab', { name: /todo\.md/ })).toBeTruthy());
    expect(screen.getByText('notes')).toBeTruthy();
  });

  it('asks before deleting, and deletes on confirm', async () => {
    renderEditor();
    fireEvent.click(await screen.findByTitle('/demo-workspace'));
    const row = await screen.findByText('package.json');
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    expect(await screen.findByText('Delete "package.json"?')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    await waitFor(() => expect(screen.queryByText('package.json')).toBeNull());
  });

  it('⌘N opens an untitled tab with no folder; closing it offers Restore', async () => {
    renderEditor();
    await screen.findByText('No folder opened');
    await act(async () => { fireEvent.keyDown(window, { key: 'n', code: 'KeyN', ctrlKey: true }); });
    expect(await screen.findByRole('tab', { name: /Untitled-1/ })).toBeTruthy();

    // Give it some text, then close it from the tab's × button.
    const store = getEditorStore(getPluginSdk('text-editor'));
    act(() => { store.closeTab(store.getSnapshot().activeId!); });
    act(() => { store.newUntitled('meeting notes\n- item'); });
    const tab = await screen.findByRole('tab', { name: /meeting notes/ });
    await act(async () => { fireEvent.click(within(tab).getByRole('button')); });
    expect(screen.queryByRole('tab', { name: /meeting notes/ })).toBeNull();
    expect(await screen.findByText(/kept under Recently Closed/)).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore' })); });
    expect(await screen.findByRole('tab', { name: /meeting notes/ })).toBeTruthy();
  });

  it('Local History: turn on, save, compare a snapshot, delete it', async () => {
    renderEditor();
    fireEvent.click(await screen.findByTitle('/demo-workspace'));
    await act(async () => { fireEvent.click(await screen.findByText('README.md')); });
    await screen.findByRole('tab', { name: /README\.md/ });
    expect(await screen.findByText(/Turn on to keep a snapshot/)).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Local History' })); });
    const store = getEditorStore(getPluginSdk('text-editor'));
    act(() => { store.newUntitled(); store.closeTab(store.getSnapshot().activeId!); });
    const id = store.getSnapshot().tabs[0].id;
    const view = (store as unknown as { view: { dispatch: (s: unknown) => void; state: { doc: { length: number } } } }).view;
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: 'more' } }); });
    await act(async () => { await store.save(id); });

    const row = await screen.findByText('Before save');
    await act(async () => { fireEvent.click(row); });
    expect(await screen.findByText(/Left: snapshot/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Delete Snapshot/ })); });
    expect(await screen.findByText(/Delete the snapshot from/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    await waitFor(() => expect(screen.queryByText('Before save')).toBeNull());
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('opens a file in the read-only viewer: lines, search, go to line', async () => {
    renderEditor();
    fireEvent.click(await screen.findByTitle('/demo-workspace'));
    fireEvent.contextMenu(await screen.findByText('README.md'));
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: /Open in Viewer/ })); });
    expect((await screen.findAllByText('Read-only')).length).toBeGreaterThan(0); // badge + status bar
    expect(await screen.findByText('# Demo workspace')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'quick open' } });
    await act(async () => { fireEvent.submit(screen.getByLabelText('Find').closest('form')!); });
    await waitFor(() => expect(screen.getByTestId('hit-position').textContent).toBe('1 / 1 results'));
    // Highlighted in the result list and on the line it jumped to.
    expect(screen.getAllByText('Quick Open', { selector: 'mark' })).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Go to line'), { target: { value: '6' } });
    await act(async () => { fireEvent.submit(screen.getByLabelText('Go to line').closest('form')!); });
    // Back to the editor from the toolbar.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open in Editor/ })); });
    await waitFor(() => expect(screen.queryByLabelText('Find')).toBeNull());
  });

  it('word wrap applies to the viewer too (files too large to edit open there)', async () => {
    renderEditor();
    fireEvent.click(await screen.findByTitle('/demo-workspace'));
    fireEvent.contextMenu(await screen.findByText('README.md'));
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: /Open in Viewer/ })); });
    const line = await screen.findByText('# Demo workspace');
    expect(line.className).toContain('whitespace-pre');
    expect(line.className).not.toContain('whitespace-pre-wrap');

    // Alt+Z, as in the editor.
    await act(async () => { fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', altKey: true }); });
    await waitFor(() => expect(screen.getByText('# Demo workspace').className).toContain('whitespace-pre-wrap'));
    expect(screen.getByRole('button', { name: 'Wrap: on' }).getAttribute('aria-pressed')).toBe('true');

    // And off again from the status bar.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Wrap: on' })); });
    await waitFor(() => expect(screen.getByText('# Demo workspace').className).not.toContain('whitespace-pre-wrap'));
  });

  describe('viewer: long lines, scrolling, appearance', () => {
    const LONG = `${'x'.repeat(10_000)}NEEDLE${'y'.repeat(50)}`;

    async function openViewer(content: string) {
      renderEditor();
      fireEvent.click(await screen.findByTitle('/demo-workspace'));
      await screen.findByText('README.md');
      const store = getEditorStore(getPluginSdk('text-editor'));
      await act(async () => {
        await store.fs.writeFile('/demo-workspace/README.md', content);
        await store.openInViewer('/demo-workspace/README.md');
      });
      await screen.findAllByText('Read-only');
      return store;
    }
    const row = (n: number) => screen.getByTestId('viewer-lines').querySelector<HTMLElement>(`[data-line="${n}"]`);

    it('cuts a line at 8 KB, shows all of it on demand, and collapses it again', async () => {
      await openViewer(`short\n${LONG}\nend\n`);
      await waitFor(() => expect(row(1)?.textContent).toContain('xxx'));
      expect(row(1)!.textContent).not.toContain('NEEDLE');

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /click to show all of it/ })); });
      await waitFor(() => expect(row(1)!.textContent).toContain('NEEDLE'));

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Collapse line' })); });
      await waitFor(() => expect(row(1)!.textContent).not.toContain('NEEDLE'));
    });

    it('a search hit past the cut loads the whole line and highlights it', async () => {
      await openViewer(`short\n${LONG}\nend\n`);
      fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'NEEDLE' } });
      await act(async () => { fireEvent.submit(screen.getByLabelText('Find').closest('form')!); });
      await waitFor(() => expect(row(1)!.querySelector('mark')?.textContent).toBe('NEEDLE'));
    });

    it('with wrap on, the wheel scrolls by rows (not by the scaled scrollbar)', async () => {
      await openViewer(Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));
      await waitFor(() => expect(row(0)?.textContent).toContain('line 1'));
      await act(async () => { fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', altKey: true }); });
      const scroller = screen.getByRole('region', { name: 'README.md' });
      // 13px × 1.6 = 21px rows: three rows down.
      await act(async () => { fireEvent.wheel(scroller, { deltaY: 63 }); });
      await waitFor(() => expect(screen.getByTestId('viewer-lines').firstElementChild?.getAttribute('data-line')).toBe('3'));
      await act(async () => { fireEvent.keyDown(scroller, { key: 'ArrowDown' }); });
      await waitFor(() => expect(screen.getByTestId('viewer-lines').firstElementChild?.getAttribute('data-line')).toBe('4'));
      await act(async () => { fireEvent.keyDown(scroller, { key: 'Home' }); });
      await waitFor(() => expect(screen.getByTestId('viewer-lines').firstElementChild?.getAttribute('data-line')).toBe('0'));
    });

    it('search: total count, Enter / Shift+Enter / F3 between hits, next page past the first 200', async () => {
      const content = Array.from({ length: 1000 }, (_, i) => (i % 2 ? `hit ${i}` : `miss ${i}`)).join('\n');
      await openViewer(content);
      const find = screen.getByLabelText('Find');
      fireEvent.change(find, { target: { value: 'hit' } });
      await act(async () => { fireEvent.submit(find.closest('form')!); });
      const position = () => screen.getByTestId('hit-position').textContent;
      // The first 200 are listed; the total is counted after.
      await waitFor(() => expect(position()).toBe('1 / 500 results'));
      expect(screen.getByText(/showing 200/)).toBeTruthy();
      expect(row(1)?.querySelector('mark')?.textContent).toBe('hit');

      // Enter again on the same query: next. Shift+Enter: back.
      await act(async () => { fireEvent.submit(find.closest('form')!); });
      await waitFor(() => expect(position()).toBe('2 / 500 results'));
      await act(async () => { fireEvent.keyDown(find, { key: 'Enter', shiftKey: true }); });
      await waitFor(() => expect(position()).toBe('1 / 500 results'));
      // Not every hit is loaded yet, so Previous doesn't wrap to the end.
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Previous match/ })); });
      expect(position()).toBe('1 / 500 results');

      // From the 200th, Next loads the next page.
      await act(async () => { fireEvent.click(screen.getByText('399', { exact: false, selector: 'button span' }).closest('button')!); });
      await waitFor(() => expect(position()).toBe('200 / 500 results'));
      await act(async () => { fireEvent.keyDown(screen.getByRole('region', { name: 'README.md' }), { key: 'F3' }); });
      await waitFor(() => expect(position()).toBe('201 / 500 results'));
      expect(screen.getByText(/showing 400/)).toBeTruthy();

      // A different query is a new search, not "next".
      fireEvent.change(find, { target: { value: 'miss 99' } });
      await act(async () => { fireEvent.submit(find.closest('form')!); });
      await waitFor(() => expect(position()).toBe('1 / 5 results')); // 990, 992 … 998
      // Every hit loaded: Previous from the first wraps to the last.
      await act(async () => { fireEvent.keyDown(find, { key: 'Enter', shiftKey: true }); });
      await waitFor(() => expect(position()).toBe('5 / 5 results'));
    });

    it('follows the editor font size (⌘= / ⌘−)', async () => {
      await openViewer('hello\n');
      const scroller = screen.getByRole('region', { name: 'README.md' });
      expect(scroller.style.fontSize).toBe('13px');
      await act(async () => { fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true }); });
      await waitFor(() => expect(scroller.style.fontSize).toBe('14px'));
      expect(row(0)!.style.height).toBe(`${Math.round(14 * 1.6)}px`);
    });
  });
});
