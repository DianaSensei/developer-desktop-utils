import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

/**
 * Like useState, but persists the value to localStorage under `key` so a tool
 * keeps its latest input/selection after the app closes or you switch away and
 * back. Only JSON-serializable values are supported.
 */
export function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // ignore corrupt/blocked storage and fall back to the initial value
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  // Avoid writing back the value we just read on the first render.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // storage full or unavailable; nothing we can do
    }
  }, [key, state]);

  return [state, setState] as [T, Dispatch<SetStateAction<T>>];
}
