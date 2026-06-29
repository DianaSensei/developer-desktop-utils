// Recently-used input values for the Kafka tool (produce/consume comboboxes).
//
// Remembers the topics (and produce keys) you've actually used, per broker, so
// the comboboxes can suggest them again — most-recent first. Shared via
// `useKafkaRecentMatches` (useSyncExternalStore) and persisted to localStorage,
// mirroring the RabbitMQ tool's inputHistoryStore.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'devtool:kafka:inputHistory';
const MAX = 25; // per field, per broker

export type KafkaHistoryField = 'topic' | 'key';

type BrokerHistory = Partial<Record<KafkaHistoryField, string[]>>;
type Store = Record<string, BrokerHistory>;

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

function list(brokerId: string, field: KafkaHistoryField): string[] {
  return store[brokerId]?.[field] ?? EMPTY;
}

export const kafkaInputHistory = {
  get: list,

  /** Record a freshly-used value, moving it to the front (deduped, capped). */
  add(brokerId: string, field: KafkaHistoryField, value: string) {
    const v = value.trim();
    if (!v) return;
    const cur = list(brokerId, field);
    if (cur[0] === v) return;
    const next = [v, ...cur.filter((x) => x !== v)].slice(0, MAX);
    store = { ...store, [brokerId]: { ...store[brokerId], [field]: next } };
    emit();
  },

  /** Forget one remembered value (the × in the dropdown). */
  remove(brokerId: string, field: KafkaHistoryField, value: string) {
    const cur = list(brokerId, field);
    if (!cur.includes(value)) return;
    store = { ...store, [brokerId]: { ...store[brokerId], [field]: cur.filter((x) => x !== value) } };
    emit();
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function useKafkaInputHistory(brokerId: string, field: KafkaHistoryField): string[] {
  return useSyncExternalStore(
    subscribe,
    () => store[brokerId]?.[field] ?? EMPTY,
    () => store[brokerId]?.[field] ?? EMPTY,
  );
}

/** History entries matching `query`, most-recent first, capped — for dropdowns. */
export function useKafkaRecentMatches(brokerId: string, field: KafkaHistoryField, query: string, limit = 8): string[] {
  const recent = useKafkaInputHistory(brokerId, field);
  const q = query.trim().toLowerCase();
  return recent.filter((v) => v.toLowerCase().includes(q)).slice(0, limit);
}
