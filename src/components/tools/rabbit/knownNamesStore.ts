// Known-names store (AMQP-only mode).
//
// AMQP can't enumerate queues/exchanges, so for brokers with no management API
// the tool works off names the user types. This module-level store remembers
// those names per connection (persisted to localStorage) and is shared across
// the Queues/Exchanges lists, the Consumers panel and the publish comboboxes via
// `useKnownNames` (useSyncExternalStore).

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'devtool:rabbit:knownNames';

interface ConnNames { queues: string[]; exchanges: string[] }
type Store = Record<string, ConnNames>;

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

function entry(connId: string): ConnNames {
  return store[connId] ?? { queues: [], exchanges: [] };
}

function addTo(list: string[], name: string): string[] {
  const n = name.trim();
  if (!n || list.includes(n)) return list;
  return [...list, n].sort((a, b) => a.localeCompare(b));
}

export const knownNamesStore = {
  getQueues: (connId: string) => entry(connId).queues,
  getExchanges: (connId: string) => entry(connId).exchanges,

  addQueue(connId: string, name: string) {
    const e = entry(connId);
    const queues = addTo(e.queues, name);
    if (queues === e.queues) return;
    store = { ...store, [connId]: { ...e, queues } };
    emit();
  },
  addExchange(connId: string, name: string) {
    const e = entry(connId);
    const exchanges = addTo(e.exchanges, name);
    if (exchanges === e.exchanges) return;
    store = { ...store, [connId]: { ...e, exchanges } };
    emit();
  },
  removeQueue(connId: string, name: string) {
    const e = entry(connId);
    store = { ...store, [connId]: { ...e, queues: e.queues.filter((q) => q !== name) } };
    emit();
  },
  removeExchange(connId: string, name: string) {
    const e = entry(connId);
    store = { ...store, [connId]: { ...e, exchanges: e.exchanges.filter((x) => x !== name) } };
    emit();
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Reactive snapshot of the known names for a connection. */
export function useKnownNames(connId: string): ConnNames {
  return useSyncExternalStore(
    subscribe,
    () => store[connId] ?? EMPTY,
    () => store[connId] ?? EMPTY,
  );
}

const EMPTY: ConnNames = { queues: [], exchanges: [] };
