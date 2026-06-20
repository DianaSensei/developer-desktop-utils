import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /**
   * Debounce localStorage writes by this many ms. The in-memory value still
   * updates synchronously (so the UI stays responsive); only the serialize +
   * write is deferred and coalesced. Pending writes are flushed on unmount and
   * before the window unloads. Default 0 = write immediately.
   */
  debounceMs?: number;
}

/**
 * Like useState, but persists the value to localStorage under `key` so a tool
 * keeps its latest input/selection after the app closes or you switch away and
 * back. Only JSON-serializable values are supported.
 *
 * For large/frequently-mutated values (e.g. a collections tree edited on every
 * keystroke) pass `{ debounceMs }` to avoid serializing the whole structure on
 * each change.
 */
export function usePersistentState<T>(key: string, initial: T | (() => T), options?: Options) {
  const debounceMs = options?.debounceMs ?? 0;
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // ignore corrupt/blocked storage and fall back to the initial value
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const write = useCallback(() => {
    try {
      localStorage.setItem(key, JSON.stringify(stateRef.current));
    } catch {
      // storage full or unavailable; nothing we can do
    }
  }, [key]);

  // Avoid writing back the value we just read on the first render.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    if (debounceMs <= 0) { write(); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(write, debounceMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state, debounceMs, write]);

  // Flush any pending debounced write on unmount / page unload.
  useEffect(() => {
    if (debounceMs <= 0) return;
    const flush = () => write();
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); write(); };
  }, [debounceMs, write]);

  return [state, setState] as [T, Dispatch<SetStateAction<T>>];
}
