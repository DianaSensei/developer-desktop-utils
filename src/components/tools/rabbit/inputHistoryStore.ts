// Recently-used input values (publish/consume comboboxes).
//
// Remembers the exchange, routing-key and queue values you've actually used, per
// connection, so the comboboxes can suggest them again — most-recent first,
// independent of what the broker can enumerate (handy in AMQP-only mode). Shared
// via `useInputHistory` (useSyncExternalStore) and persisted to localStorage,
// mirroring `knownNamesStore`.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'devtool:rabbit:inputHistory';
const MAX = 25; // per field, per connection

export type HistoryField = 'exchange' | 'routingKey' | 'queue';

type ConnHistory = Partial<Record<HistoryField, string[]>>;
type Store = Record<string, ConnHistory>;

const listeners = new Set<() => void>();
let store: Store = load();

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

const EMPTY: string[] = [];

function list(connId: string, field: HistoryField): string[] {
  return store[connId]?.[field] ?? EMPTY;
}

export const inputHistory = {
  get: list,

  /** Record a freshly-used value, moving it to the front (deduped, capped). */
  add(connId: string, field: HistoryField, value: string) {
    const v = value.trim();
    if (!v) return;
    const cur = list(connId, field);
    if (cur[0] === v) return; // already most-recent — no change
    const next = [v, ...cur.filter((x) => x !== v)].slice(0, MAX);
    store = { ...store, [connId]: { ...store[connId], [field]: next } };
    emit();
  },

  /** Forget one remembered value (the × in the dropdown). */
  remove(connId: string, field: HistoryField, value: string) {
    const cur = list(connId, field);
    if (!cur.includes(value)) return;
    store = { ...store, [connId]: { ...store[connId], [field]: cur.filter((x) => x !== value) } };
    emit();
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Reactive most-recent-first history for one connection + field. */
export function useInputHistory(connId: string, field: HistoryField): string[] {
  return useSyncExternalStore(
    subscribe,
    () => store[connId]?.[field] ?? EMPTY,
    () => store[connId]?.[field] ?? EMPTY,
  );
}

/** History entries matching `query`, most-recent first, capped — for dropdowns. */
export function useRecentMatches(connId: string, field: HistoryField, query: string, limit = 8): string[] {
  const recent = useInputHistory(connId, field);
  const q = query.trim().toLowerCase();
  return recent.filter((v) => v.toLowerCase().includes(q)).slice(0, limit);
}
