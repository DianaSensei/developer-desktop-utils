// Live-consumer store.
//
// Consumers must keep running while you move between tabs/views *inside* the
// RabbitMQ tool, so their state can't live in a component that unmounts on tab
// switch. This module-level store owns the active subscriptions; components read
// it via `useConsumers` / `useQueueConsumer` (useSyncExternalStore). The tool
// stops everything on unmount (see RabbitClient) so nothing leaks when you leave.

import { useSyncExternalStore } from 'react';
import { getPluginSdk } from '@/platform';
import { createRabbitApi, type ConsumedMessage, type ConsumeAckMode, type ReplyOptions } from './types';

// Bounded ring buffer of the most recent messages kept for inspection/search.
const MAX_MESSAGES = 2000;
// Coalesce incoming deliveries into one UI update per window. Without this, a
// high-traffic queue (consume/respond mode pulls as fast as it can) would trigger
// a React re-render per message and freeze the UI. Peek mode is already bounded by
// prefetch; consume/respond are not — this keeps the viewer responsive under load.
const FLUSH_MS = 120;

export interface ConsumerSession {
  /** Backend consumer id ('' until consumeStart resolves). */
  id: string;
  connId: string;
  queue: string;
  mode: ConsumeAckMode;
  prefetch: number;
  reply: ReplyOptions | null;
  /** Most recent messages, newest first, capped at MAX_MESSAGES. */
  messages: ConsumedMessage[];
  /** Total received since start (or since the last Clear) — not capped. */
  received: number;
  /** When paused, the view is frozen; new messages keep buffering and apply on resume. */
  paused: boolean;
  /** Count of messages buffered while paused (waiting to be shown). */
  bufferedWhilePaused: number;
  startedAt: number;
  starting: boolean;
}

type Listener = () => void;

const sessions = new Map<string, ConsumerSession>();
const listeners = new Set<Listener>();
let snapshot: ConsumerSession[] = [];

// NUL viết bằng escape, không nhúng byte thật — xem apiclient/cookies.ts.
const key = (connId: string, queue: string) => `${connId}\u0000${queue}`;

function emit() {
  snapshot = Array.from(sessions.values());
  listeners.forEach((l) => l());
}

// Per-session pending deliveries + flush timer (batching).
const pending = new Map<string, ConsumedMessage[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Queue a delivery and schedule a single coalesced flush. */
function enqueue(k: string, msg: ConsumedMessage) {
  let buf = pending.get(k);
  if (!buf) { buf = []; pending.set(k, buf); }
  buf.push(msg);
  if (!timers.has(k)) timers.set(k, setTimeout(() => flush(k), FLUSH_MS));
}

/** Merge buffered deliveries into the session in one batch + one re-render. */
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
  // buf is oldest→newest; reverse to newest→oldest, then prepend.
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

/**
 * Store này sống ở phạm vi module CHÍNH VÌ consumer phải chạy tiếp khi người
 * dùng chuyển sang tool khác — nên nó không gọi hook được. `getPluginSdk` là
 * lối lấy SDK ngoài React dành đúng cho trường hợp này: quyền và allowlist vẫn
 * được kiểm y như khi gọi từ trong component.
 */
const sdk = getPluginSdk('rabbit-client');
const rabbitApi = createRabbitApi(sdk);

export const consumerStore = {
  /** Start consuming a queue. Throws (and registers nothing) if the start fails. */
  async start(connId: string, queue: string, mode: ConsumeAckMode, prefetch: number, reply: ReplyOptions | null = null): Promise<void> {
    const k = key(connId, queue);
    if (sessions.has(k)) return; // already running

    const session: ConsumerSession = {
      id: '', connId, queue, mode, prefetch, reply, messages: [], received: 0, paused: false, bufferedWhilePaused: 0, startedAt: Date.now(), starting: true,
    };
    sessions.set(k, session);
    emit();

    // Batch deliveries (see enqueue/flush) so high-traffic queues don't trigger a
    // re-render per message.
    const channel = await sdk.native.channel<ConsumedMessage>(
      (msg) => { if (sessions.has(k)) enqueue(k, msg); },
      'rabbit-consume',
    );

    try {
      const id = await rabbitApi.consumeStart({ configId: connId, queue, ackMode: mode, prefetch, reply }, channel);
      const s = sessions.get(k);
      if (!s) {
        // Stopped before start resolved — tear the backend consumer down.
        rabbitApi.consumeStop(id).catch(() => {});
        return;
      }
      s.id = id;
      s.starting = false;
      emit();
    } catch (e) {
      sessions.delete(k);
      discardPending(k); // clear any messages that arrived during the failed start
      emit();
      throw e;
    }
  },

  async stop(connId: string, queue: string): Promise<void> {
    const k = key(connId, queue);
    const s = sessions.get(k);
    if (!s) return;
    sessions.delete(k);
    discardPending(k);
    emit();
    if (s.id) {
      try { await rabbitApi.consumeStop(s.id); } catch { /* ignore */ }
    }
  },

  clear(connId: string, queue: string) {
    const k = key(connId, queue);
    const s = sessions.get(k);
    if (s) { s.messages = []; s.received = 0; s.bufferedWhilePaused = 0; discardPending(k); emit(); }
  },

  /** Freeze the view (keep buffering) or resume and apply what arrived while paused. */
  setPaused(connId: string, queue: string, paused: boolean) {
    const k = key(connId, queue);
    const s = sessions.get(k);
    if (!s || s.paused === paused) return;
    s.paused = paused;
    if (!paused) { s.bufferedWhilePaused = 0; flush(k); }
    emit();
  },

  /** Stop every consumer belonging to one connection (used on Disconnect). */
  async stopForConn(connId: string): Promise<void> {
    const all = Array.from(sessions.values()).filter((s) => s.connId === connId);
    for (const s of all) { sessions.delete(key(s.connId, s.queue)); discardPending(key(s.connId, s.queue)); }
    emit();
    await Promise.all(all.map((s) => (s.id ? rabbitApi.consumeStop(s.id).catch(() => {}) : Promise.resolve())));
  },

  async stopAll(): Promise<void> {
    const all = Array.from(sessions.values());
    sessions.clear();
    for (const s of all) discardPending(key(s.connId, s.queue));
    emit();
    await Promise.all(all.map((s) => (s.id ? rabbitApi.consumeStop(s.id).catch(() => {}) : Promise.resolve())));
  },
};

export function useConsumers(): ConsumerSession[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function useQueueConsumer(connId: string, queue: string): ConsumerSession | undefined {
  return useConsumers().find((s) => s.connId === connId && s.queue === queue);
}
