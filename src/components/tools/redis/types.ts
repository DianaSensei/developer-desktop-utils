import { invoke, Channel } from '@tauri-apps/api/core';

// ── Connection profile (persisted via Rust to the app-data dir) ───────────────

export interface RedisConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  useTls: boolean;
}

export const EMPTY_CONNECTION: RedisConnection = {
  id: '',
  name: '',
  host: 'localhost',
  port: 6379,
  username: null,
  password: null,
  useTls: false,
};

// ── Overview ────────────────────────────────────────────────────────────────

export interface RedisOverview {
  info: string;
  dbsize: number;
}

// ── Key browsing ──────────────────────────────────────────────────────────────

export interface ScanPage {
  cursor: number;
  keys: string[];
}

export interface KeySummary {
  key: string;
  type: string;
  /** Milliseconds until expiry; -1 = no expiry, -2 = key no longer exists. */
  ttlMs: number;
}

/** One stream entry: `[id, [[field, value], ...]]`. */
export type StreamEntry = [string, [string, string][]];

export type KeyValue =
  | { type: 'none' }
  | { type: 'string'; value: string; ttlMs: number }
  | { type: 'hash'; fields: [string, string][]; ttlMs: number; truncated: boolean }
  | { type: 'list'; items: string[]; ttlMs: number; truncated: boolean }
  | { type: 'set'; members: string[]; ttlMs: number; truncated: boolean }
  | { type: 'zset'; members: [string, number][]; ttlMs: number; truncated: boolean }
  | { type: 'stream'; entries: StreamEntry[]; ttlMs: number; truncated: boolean }
  | { type: 'unsupported'; redisType: string; ttlMs: number };

// ── Pub/Sub ─────────────────────────────────────────────────────────────────

export interface PubSubMessage {
  channel: string;
  /** Set only when the message arrived via a pattern subscription. */
  pattern: string | null;
  payload: string;
}

// ── Server admin ────────────────────────────────────────────────────────────

/** One row of `CLIENT LIST` — field set varies by Redis version, kept loose. */
export type ClientInfo = Record<string, string>;

export interface SlowLogEntry {
  id: number;
  /** Unix timestamp (seconds) the command ran at. */
  timestamp: number;
  durationMicros: number;
  command: string[];
  clientAddr: string | null;
  clientName: string | null;
}

// ── Generic command reply (CLI console + editor mutations) ────────────────────

export type RedisReply =
  | { kind: 'Nil' }
  | { kind: 'Int'; data: number }
  | { kind: 'Bulk'; data: string }
  | { kind: 'Status'; data: string }
  | { kind: 'Array'; data: RedisReply[] }
  | { kind: 'Error'; data: string };

// ── Invoke wrappers ───────────────────────────────────────────────────────────

export const redisApi = {
  listConfigs: () => invoke<RedisConnection[]>('redis_list_configs'),
  saveConfig: (config: RedisConnection) => invoke<RedisConnection>('redis_save_config', { config }),
  deleteConfig: (configId: string) => invoke<void>('redis_delete_config', { configId }),
  testConnection: (config: RedisConnection) => invoke<void>('redis_test_connection', { config }),

  overview: (configId: string, db: number) =>
    invoke<RedisOverview>('redis_overview', { configId, db }),

  scanKeys: (configId: string, db: number, cursor: number, pattern: string, count: number) =>
    invoke<ScanPage>('redis_scan_keys', { configId, db, cursor, pattern, count }),

  keySummary: (configId: string, db: number, keys: string[]) =>
    invoke<KeySummary[]>('redis_key_summary', { configId, db, keys }),

  getKey: (configId: string, db: number, key: string) =>
    invoke<KeyValue>('redis_get_key', { configId, db, key }),

  setString: (configId: string, db: number, key: string, value: string, ttlSeconds: number | null) =>
    invoke<void>('redis_set_string', { configId, db, key, value, ttlSeconds }),

  setTtl: (configId: string, db: number, key: string, ttlSeconds: number | null) =>
    invoke<void>('redis_set_ttl', { configId, db, key, ttlSeconds }),

  deleteKeys: (configId: string, db: number, keys: string[]) =>
    invoke<number>('redis_delete_keys', { configId, db, keys }),

  renameKey: (configId: string, db: number, oldKey: string, newKey: string) =>
    invoke<void>('redis_rename_key', { configId, db, oldKey, newKey }),

  /** Run an arbitrary command. Backs the CLI console and the key editors' mutations. */
  exec: (configId: string, db: number, args: string[]) =>
    invoke<RedisReply>('redis_exec', { configId, db, args }),

  memoryUsage: (configId: string, db: number, key: string) =>
    invoke<number | null>('redis_memory_usage', { configId, db, key }),

  // ── Pub/Sub ───────────────────────────────────────────────────────────────

  /** Subscribe to channels/patterns; messages stream to `onMessage`. Returns the subscription id. */
  pubsubSubscribe: (configId: string, channels: string[], patterns: string[], onMessage: Channel<PubSubMessage>) =>
    invoke<string>('redis_pubsub_subscribe', { configId, channels, patterns, onMessage }),

  pubsubUnsubscribe: (subscriptionId: string) =>
    invoke<void>('redis_pubsub_unsubscribe', { subscriptionId }),

  publish: (configId: string, channel: string, message: string) =>
    invoke<number>('redis_publish', { configId, channel, message }),

  // ── Server admin ──────────────────────────────────────────────────────────

  clientList: (configId: string) =>
    invoke<ClientInfo[]>('redis_client_list', { configId }),

  slowlog: (configId: string, count: number) =>
    invoke<SlowLogEntry[]>('redis_slowlog', { configId, count }),

  configGet: (configId: string, pattern: string) =>
    invoke<[string, string][]>('redis_config_get', { configId, pattern }),

  configSet: (configId: string, param: string, value: string) =>
    invoke<void>('redis_config_set', { configId, param, value }),
};
