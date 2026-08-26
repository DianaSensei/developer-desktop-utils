import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Multi-select state for the container tool's list views (containers, images,
 * volumes, networks). All four had — or wanted — the same "checkbox column +
 * select-all header + bulk action bar" behaviour, so it lives here once
 * instead of being re-implemented per view.
 *
 * `rows` is the *visible* (filtered + sorted) row list; `keyOf` maps a row to
 * its stable id (container/image id, volume/network name). Selection is kept
 * as a key set so it survives re-sorts and filter changes — a row hidden by
 * the search box stays selected, and the bulk bar keeps counting it, which is
 * why `selectAllVisible` and `clear` are separate from `prune`.
 *
 * Range select: pass the row index and the click's `shiftKey` to `toggle` and
 * a shift-click extends from the previously clicked row, the way a file
 * manager does.
 */
export function useRowSelection<T>(rows: T[], keyOf: (row: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndexRef = useRef<number | null>(null);

  const visibleKeys = useMemo(() => rows.map(keyOf), [rows, keyOf]);

  const isSelected = useCallback((key: string) => selected.has(key), [selected]);

  const toggle = useCallback((key: string, index?: number, shiftKey?: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const anchor = lastIndexRef.current;
      if (shiftKey && anchor !== null && index !== undefined) {
        const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
        // A shift-click always *adds* the range (never clears it), matching the
        // way the rest of the app's multi-selects behave.
        for (let i = from; i <= to; i++) next.add(visibleKeys[i]);
      } else if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    if (index !== undefined) lastIndexRef.current = index;
  }, [visibleKeys]);

  const selectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleKeys.forEach((k) => next.add(k));
      return next;
    });
  }, [visibleKeys]);

  const clearVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleKeys.forEach((k) => next.delete(k));
      return next;
    });
  }, [visibleKeys]);

  const clear = useCallback(() => {
    setSelected(new Set());
    lastIndexRef.current = null;
  }, []);

  /** Drop keys that no longer exist — call after a reload so removed rows
   *  don't linger in the count of a stale selection. */
  const prune = useCallback((existing: string[]) => {
    const alive = new Set(existing);
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => alive.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const someVisibleSelected = !allVisibleSelected && visibleKeys.some((k) => selected.has(k));

  const toggleAllVisible = useCallback(() => {
    if (allVisibleSelected) clearVisible();
    else selectAllVisible();
  }, [allVisibleSelected, clearVisible, selectAllVisible]);

  return {
    selected,
    keys: useMemo(() => Array.from(selected), [selected]),
    count: selected.size,
    isSelected,
    toggle,
    selectAllVisible,
    toggleAllVisible,
    clear,
    prune,
    allVisibleSelected,
    someVisibleSelected,
    /** Visible rows not yet selected — drives the "Select all N" affordance. */
    unselectedVisibleCount: visibleKeys.filter((k) => !selected.has(k)).length,
  };
}
