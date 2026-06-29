// Realtime Kafka consumer store.
//
// Anonymous consumers must keep running while you move between views inside the
// Kafka tool, so their state lives in this module-level store (not a component
// that unmounts on view switch). Components read it via `useKafkaConsumers` /
// `useTopicConsumer` (useSyncExternalStore). The tool stops everything on unmount
// so nothing leaks when you leave. Deliveries are batched into one UI update per
// window so a high-throughput topic can't trigger a re-render per message.

import { useSyncExternalStore } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { kafkaApi, type KafkaConsumedMessage, type ConsumeFrom } from './types';

const MAX_MESSAGES = 2000;
const FLUSH_MS = 120;

export interface KafkaConsumerSession {
  /** Backend consumer id ('' until consumeStart resolves). */
  id: string;
  brokerId: string;
  topic: string;
  from: ConsumeFrom;
  /** Most recent records, newest first, capped at MAX_MESSAGES. */
  messages: KafkaConsumedMessage[];
  /** Total received since start (or last Clear) — not capped. */
  received: number;
  /** When paused, the view is frozen; new records keep buffering and apply on resume. */
  paused: boolean;
  /** Count of records buffered while paused (waiting to be shown). */
  bufferedWhilePaused: number;
  startedAt: number;
  starting: boolean;
}

type Listener = () => void;

const sessions = new Map<string, KafkaConsumerSession>();
const listeners = new Set<Listener>();
let snapshot: KafkaConsumerSession[] = [];

const pending = new Map<string, KafkaConsumedMessage[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const key = (brokerId: string, topic: string) => `${brokerId} ${topic}`;

function emit() {
  snapshot = Array.from(sessions.values());
  listeners.forEach((l) => l());
}

function enqueue(k: string, msg: KafkaConsumedMessage) {
  let buf = pending.get(k);
  if (!buf) { buf = []; pending.set(k, buf); }
  buf.push(msg);
  if (!timers.has(k)) timers.set(k, setTimeout(() => flush(k), FLUSH_MS));
}

function flush(k: string) {
  timers.delete(k);
  const buf = pending.get(k);
  if (!buf || buf.length === 0) return;
  const s = sessions.get(k);
  if (!s) return;
  if (s.paused) {
    // Frozen view: keep buffering (don't merge or clear), just surface the count.
    s.bufferedWhilePaused = buf.length;
    emit();
    return;
  }
  pending.set(k, []);
  s.received += buf.length;
  s.bufferedWhilePaused = 0;
  s.messages = buf.reverse().concat(s.messages);
  if (s.messages.length > MAX_MESSAGES) s.messages.length = MAX_MESSAGES;
  emit();
}

function discardPending(k: string) {
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
  pending.delete(k);
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const kafkaConsumerStore = {
  async start(brokerId: string, topic: string, from: ConsumeFrom): Promise<void> {
    const k = key(brokerId, topic);
    if (sessions.has(k)) return; // already running

    const session: KafkaConsumerSession = {
      id: '', brokerId, topic, from, messages: [], received: 0, paused: false, bufferedWhilePaused: 0, startedAt: Date.now(), starting: true,
    };
    sessions.set(k, session);
    emit();

    const channel = new Channel<KafkaConsumedMessage>();
    channel.onmessage = (msg) => { if (sessions.has(k)) enqueue(k, msg); };

    try {
      const id = await kafkaApi.consumeStart({ configId: brokerId, topic, from }, channel);
      const s = sessions.get(k);
      if (!s) { kafkaApi.consumeStop(id).catch(() => {}); return; } // stopped mid-start
      s.id = id;
      s.starting = false;
      emit();
    } catch (e) {
      sessions.delete(k);
      discardPending(k);
      emit();
      throw e;
    }
  },

  async stop(brokerId: string, topic: string): Promise<void> {
    const k = key(brokerId, topic);
    const s = sessions.get(k);
    if (!s) return;
    sessions.delete(k);
    discardPending(k);
    emit();
    if (s.id) { try { await kafkaApi.consumeStop(s.id); } catch { /* ignore */ } }
  },

  clear(brokerId: string, topic: string) {
    const k = key(brokerId, topic);
    const s = sessions.get(k);
    if (s) { s.messages = []; s.received = 0; s.bufferedWhilePaused = 0; discardPending(k); emit(); }
  },

  /** Freeze the view (keep buffering) or resume and apply what arrived while paused. */
  setPaused(brokerId: string, topic: string, paused: boolean) {
    const k = key(brokerId, topic);
    const s = sessions.get(k);
    if (!s || s.paused === paused) return;
    s.paused = paused;
    if (!paused) {
      s.bufferedWhilePaused = 0;
      flush(k); // apply everything buffered while paused
    }
    emit();
  },

  /** Stop every consumer for one broker (used on Disconnect). */
  async stopForBroker(brokerId: string): Promise<void> {
    const all = Array.from(sessions.values()).filter((s) => s.brokerId === brokerId);
    for (const s of all) { sessions.delete(key(s.brokerId, s.topic)); discardPending(key(s.brokerId, s.topic)); }
    emit();
    await Promise.all(all.map((s) => (s.id ? kafkaApi.consumeStop(s.id).catch(() => {}) : Promise.resolve())));
  },

  async stopAll(): Promise<void> {
    const all = Array.from(sessions.values());
    sessions.clear();
    for (const s of all) discardPending(key(s.brokerId, s.topic));
    emit();
    await Promise.all(all.map((s) => (s.id ? kafkaApi.consumeStop(s.id).catch(() => {}) : Promise.resolve())));
  },
};

export function useKafkaConsumers(): KafkaConsumerSession[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function useTopicConsumer(brokerId: string, topic: string): KafkaConsumerSession | undefined {
  return useKafkaConsumers().find((s) => s.brokerId === brokerId && s.topic === topic);
}
