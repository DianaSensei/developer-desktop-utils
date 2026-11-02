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
});
