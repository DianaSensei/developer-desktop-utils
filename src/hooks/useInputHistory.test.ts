import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInputHistory } from './useInputHistory';

// The hook reads only `config.editor.historyDebounceMs` from app config.
vi.mock('@/contexts/AppConfigContext', () => ({
  useAppConfig: () => ({ config: { editor: { historyDebounceMs: 400 } } }),
}));

const DEBOUNCE = 400;

/** Dispatch the undo chord on `window`, the way the real listener receives it. */
function pressUndo() {
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => { window.dispatchEvent(event); });
  return event;
}

/** Mount the hook over a value the test controls, mimicking a tool's state. */
function renderHistory(initial: string) {
  let current = initial;
  const apply = vi.fn((next: string) => { current = next; });
  const view = renderHook(({ value }: { value: string }) => useInputHistory(value, apply), {
    initialProps: { value: initial },
  });
  return {
    apply,
    get current() { return current; },
    /** Simulate the user typing: push a new value and let the debounce commit it. */
    type(next: string) {
      current = next;
      view.rerender({ value: next });
      act(() => { vi.advanceTimersByTime(DEBOUNCE + 10); });
    },
    unmount: view.unmount,
  };
}

describe('useInputHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('undoes the primary input when nothing else is focused', () => {
    const h = renderHistory('one');
    h.type('two');

    pressUndo();

    expect(h.apply).toHaveBeenCalledWith('one');
  });

  it('still undoes while the primary textarea has focus', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const h = renderHistory('one');
    h.type('two');

    pressUndo();

    // A <textarea> is the tool's primary input in every caller — the hook must
    // keep owning undo there, since native textarea undo is unreliable in the
    // webviews this app ships on.
    expect(h.apply).toHaveBeenCalledWith('one');
  });

  it('leaves undo alone while a secondary <input> has focus', () => {
    // e.g. the Regex Tester's pattern box, or the JSON tree search field.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const h = renderHistory('one');
    h.type('two');

    const event = pressUndo();

    expect(h.apply).not.toHaveBeenCalled();
    // Native undo for the focused field must survive.
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves undo alone inside a CodeMirror editor, which owns its own history', () => {
    // Data Converter renders a CodeMirror source pane bound to the same value.
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.tabIndex = 0;
    editor.appendChild(content);
    document.body.appendChild(editor);
    content.focus();

    const h = renderHistory('one');
    h.type('two');

    const event = pressUndo();

    expect(h.apply).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing when disabled', () => {
    let current = 'one';
    const apply = vi.fn();
    const view = renderHook(
      ({ value }: { value: string }) => useInputHistory(value, apply, false),
      { initialProps: { value: current } },
    );
    current = 'two';
    view.rerender({ value: current });
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 10); });

    pressUndo();

    expect(apply).not.toHaveBeenCalled();
  });
});
