import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { WorkspaceEditor } from './WorkspaceEditor';
import { resetEditorSession } from './session';
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
});
