import { useEffect, useRef } from 'react';

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
 */
export function useInputHistory(value: string, applyValue: (next: string) => void, enabled = true) {
  const history = useRef<string[]>([value]);
  const index = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
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
    timer.current = setTimeout(() => commit(valueRef.current), 400);
    return () => clearTimeout(timer.current);
  }, [value]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;

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
