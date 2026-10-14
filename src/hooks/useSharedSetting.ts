import { useCallback, useSyncExternalStore } from 'react';
import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * A persisted setting that every component reading it shares, unlike
 * `usePersistentState`, whose copies stop agreeing after the first change.
 * For switches read in several places at once (the MCP background bridge and
 * per-tool MCP access are read by Settings, the setup dialog, each tool's
 * bridge and the MCP management tools): a change from any of them reaches
 * all of them at once.
 */

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, initial: T): T {
  const raw = storageGet(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = initial;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      // Unreadable: fall back to the initial value.
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => set!.delete(listener);
}

export function useSharedSetting<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    useCallback((listener) => subscribe(key, listener), [key]),
    () => read(key, initial),
  );
  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, initial);
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      storageSet(key, JSON.stringify(resolved));
      for (const listener of listeners.get(key) ?? []) listener();
    },
    // `initial` is a constant default at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, setValue];
}
