import { useEffect, useRef } from 'react';
import { useAppConfig } from '@/contexts/AppConfigContext';

/**
 * True when the undo shortcut belongs to whatever currently has focus, rather
 * than to the tool's primary input.
 *
 * The listener is on `window`, so without this guard ⌘Z anywhere in the tool
 * reverts the main input and — because the handler calls `preventDefault()` —
 * also destroys the native undo of the field being typed in. Two concrete
 * cases this fixes:
 *
 *   • A secondary field: the Regex Tester's pattern and replacement boxes, the
 *     JSON tree search. ⌘Z there used to blow away the *test string* instead of
 *     undoing the few characters just typed.
 *   • A CodeMirror editor (Data Converter's source pane): CodeMirror ships its
 *     own history in `basicSetup` and already handled the key, so both undos
 *     ran and the document jumped two steps at once.
 *
 * A `<textarea>` is deliberately *not* excluded — it is the tool's primary
 * input in every current caller, and the whole point of this hook is that the
 * webviews' native textarea undo is unreliable.
 */
function shortcutBelongsToFocusedField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  // CodeMirror (and any other rich editor) owns its own undo stack.
  if (el.closest('.cm-editor')) return true;
  return el.tagName === 'INPUT' || (el.isContentEditable && el.tagName !== 'TEXTAREA');
}

/**
 * Adds undo/redo history to a tool's primary input. Pass the current value and
 * the setter used to apply a value. While the tool is mounted, the OS undo /
 * redo shortcuts revert/restore previous input data:
 *   - Undo:  ⌘Z / Ctrl+Z
 *   - Redo:  ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y
 *
 * User edits are coalesced (debounced) into history entries, while programmatic
 * changes (paste, format, clear) are captured as well. History lives for the
 * lifetime of the mounted tool.
 *
 * The shortcut is ignored while focus is in a field that owns its own undo —
 * see `shortcutBelongsToFocusedField`.
 */
export function useInputHistory(value: string, applyValue: (next: string) => void, enabled = true) {
  const { config } = useAppConfig();
  const history = useRef<string[]>([value]);
  const index = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isApplying = useRef(false);

  const valueRef = useRef(value);
  valueRef.current = value;
  const applyRef = useRef(applyValue);
  applyRef.current = applyValue;

  const commit = (next: string) => {
    if (history.current[index.current] === next) return;
    history.current = history.current.slice(0, index.current + 1);
    history.current.push(next);
    index.current = history.current.length - 1;
  };

  // Record (debounced) whenever the value changes from a normal edit.
  useEffect(() => {
    if (isApplying.current) {
      isApplying.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(valueRef.current), config.editor.historyDebounceMs);
    return () => clearTimeout(timer.current);
  }, [value, config.editor.historyDebounceMs]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      if (shortcutBelongsToFocusedField()) return;

      event.preventDefault();
      // Flush any pending (debounced) edit so it becomes an undo step.
      clearTimeout(timer.current);
      commit(valueRef.current);

      if (isUndo && index.current > 0) {
        index.current--;
        isApplying.current = true;
        applyRef.current(history.current[index.current]);
      } else if (isRedo && index.current < history.current.length - 1) {
        index.current++;
        isApplying.current = true;
        applyRef.current(history.current[index.current]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
