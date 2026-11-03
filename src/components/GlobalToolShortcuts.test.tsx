import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { TOOL_SHORTCUTS_KEY } from '@/lib/toolShortcuts';
import { GlobalToolShortcuts } from './GlobalToolShortcuts';
import { ToolShortcutSettings } from './ToolShortcutSettings';

// jsdom is not a Mac, so Mod = Ctrl.

function Where() {
  const { isFeatureEnabled } = useFeatures();
  return (
    <>
      <span data-testid="path">{useLocation().pathname}</span>
      <span data-testid="diff-enabled">{String(isFeatureEnabled('diff'))}</span>
    </>
  );
}

function Harness({ settings = false }: { settings?: boolean }) {
  return (
    <MemoryRouter initialEntries={['/json']}>
      <LocaleProvider>
        <FeatureProvider>
          <WorkspaceProvider>
            <Where />
            <input aria-label="field" />
            <GlobalToolShortcuts />
            {settings && <ToolShortcutSettings />}
          </WorkspaceProvider>
        </FeatureProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

const path = () => screen.getByTestId('path').textContent;
const saved = () => JSON.parse(storageGet(TOOL_SHORTCUTS_KEY) ?? '{}') as Record<string, string>;

function setShortcuts(map: Record<string, string>) {
  storageSet(TOOL_SHORTCUTS_KEY, JSON.stringify(map));
}

beforeEach(() => {
  for (const k of [TOOL_SHORTCUTS_KEY, 'devtool-features', 'devtool-workspaces']) storageRemove(k);
});
afterEach(() => cleanup());

describe('GlobalToolShortcuts', () => {
  it('opens the assigned tool from anywhere, even while typing in a field', () => {
    setShortcuts({ 'unix-time': 'Mod+Shift+KeyU' });
    render(<Harness />);
    const field = screen.getByLabelText('field');
    field.focus();
    const ev = fireEvent.keyDown(field, { code: 'KeyU', key: 'U', ctrlKey: true, shiftKey: true });
    expect(ev).toBe(false); // default prevented
    expect(path()).toBe('/unix-time');
  });

  it('leaves other combos alone', () => {
    setShortcuts({ 'unix-time': 'Mod+Shift+KeyU' });
    render(<Harness />);
    expect(fireEvent.keyDown(window, { code: 'KeyU', key: 'u', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { code: 'KeyU', key: 'U', shiftKey: true })).toBe(true);
    expect(path()).toBe('/json');
  });

  it('turns a disabled tool on before opening it', () => {
    setShortcuts({ diff: 'Alt+KeyD' });
    render(<Harness />);
    expect(screen.getByTestId('diff-enabled').textContent).toBe('false');
    fireEvent.keyDown(window, { code: 'KeyD', key: '∂', altKey: true });
    expect(path()).toBe('/diff');
    expect(screen.getByTestId('diff-enabled').textContent).toBe('true');
  });

  it('ignores invalid stored combos', () => {
    setShortcuts({ 'unix-time': 'KeyU' });
    render(<Harness />);
    expect(fireEvent.keyDown(window, { code: 'KeyU', key: 'u' })).toBe(true);
    expect(path()).toBe('/json');
  });
});

describe('ToolShortcutSettings', () => {
  const row = (name: string) => screen.getByRole('button', { name: `Set the shortcut that opens ${name}` });

  it('records a combo, then it works app-wide and shows in the list', () => {
    render(<Harness settings />);
    fireEvent.click(row('Date / Time'));
    const recorder = screen.getByRole('button', { name: 'Set the shortcut that opens Date / Time' });
    expect(document.activeElement).toBe(recorder);
    // Holding modifiers previews them; the shortcut itself must not fire while recording.
    fireEvent.keyDown(recorder, { code: 'ControlLeft', key: 'Control', ctrlKey: true });
    expect(within(recorder).getByText('Ctrl')).toBeTruthy();
    fireEvent.keyDown(recorder, { code: 'KeyU', key: 'U', ctrlKey: true, shiftKey: true });
    expect(saved()).toEqual({ 'unix-time': 'Mod+Shift+KeyU' });
    expect(path()).toBe('/json');
    expect(screen.getByText('U')).toBeTruthy();

    fireEvent.keyDown(window, { code: 'KeyU', key: 'U', ctrlKey: true, shiftKey: true });
    expect(path()).toBe('/unix-time');
  });

  it('explains a refused combo and keeps recording', () => {
    render(<Harness settings />);
    fireEvent.click(row('Date / Time'));
    const recorder = screen.getByRole('button', { name: 'Set the shortcut that opens Date / Time' });
    fireEvent.keyDown(recorder, { code: 'KeyC', key: 'c', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toMatch(/editing/);
    fireEvent.keyDown(recorder, { code: 'KeyJ', key: 'J', ctrlKey: true, altKey: true, shiftKey: true });
    expect(screen.getByRole('alert').textContent).toMatch(/At most 3 keys/);
    fireEvent.keyDown(recorder, { code: 'KeyJ', key: 'j' });
    expect(screen.getByRole('alert').textContent).toMatch(/block typing/);
    expect(saved()).toEqual({});
    fireEvent.keyDown(recorder, { code: 'Escape', key: 'Escape' });
    expect(row('Date / Time').textContent).toBe('Set');
  });

  it('moves a combo from the tool that had it, and warns about tool overlaps', () => {
    setShortcuts({ json: 'Mod+KeyS' });
    render(<Harness settings />);
    fireEvent.click(row('Date / Time'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Set the shortcut that opens Date / Time' }), { code: 'KeyS', key: 's', ctrlKey: true });
    expect(saved()).toEqual({ 'unix-time': 'Mod+KeyS' });
    expect(screen.getByRole('status').textContent).toMatch(/Moved here from JSON Formatter/);
  });

  it('removes one shortcut, or all after confirming', async () => {
    setShortcuts({ json: 'Alt+KeyJ', 'unix-time': 'Alt+KeyU' });
    render(<Harness settings />);
    fireEvent.click(screen.getByRole('button', { name: /Remove shortcut: Date \/ Time/ }));
    expect(saved()).toEqual({ json: 'Alt+KeyJ' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    const dialog = screen.getByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove all' })); });
    expect(saved()).toEqual({});
  });
});
