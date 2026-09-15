import type { PluginSdk } from '@/platform';

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

/**
 * Lớp lệnh Redis, dựng theo `sdk.service` (Tier B — sidecar `devtool-svc-redis`)
 * thay vì gọi thẳng `invoke`. Nhờ vậy allowlist `service.methods` trong manifest
 * có hiệu lực thật — một method gõ sai hay ngoài danh sách bị chặn ngay và ghi
 * vào nhật ký, thay vì lặng lẽ đi thẳng xuống sidecar.
 *
 * Dùng qua `useRedisApi()` (xem api.ts); factory để lộ ra đây chỉ cho test và
 * cho code không phải React.
 */
export function createRedisApi(sdk: PluginSdk) {
  const call = <T,>(method: string, params?: Record<string, unknown>) =>
    sdk.service.call<T>(method, params);

  return {
    listConfigs: () => call<RedisConnection[]>('list-configs'),
    saveConfig: (config: RedisConnection) => call<RedisConnection>('save-config', { config }),
    deleteConfig: (configId: string) => call<void>('delete-config', { configId }),
    testConnection: (config: RedisConnection) => call<void>('test-connection', { config }),

    overview: (configId: string, db: number) =>
      call<RedisOverview>('overview', { configId, db }),

    scanKeys: (configId: string, db: number, cursor: number, pattern: string, count: number) =>
      call<ScanPage>('scan-keys', { configId, db, cursor, pattern, count }),

    keySummary: (configId: string, db: number, keys: string[]) =>
      call<KeySummary[]>('key-summary', { configId, db, keys }),

    getKey: (configId: string, db: number, key: string) =>
      call<KeyValue>('get-key', { configId, db, key }),

    setString: (configId: string, db: number, key: string, value: string, ttlSeconds: number | null) =>
      call<void>('set-string', { configId, db, key, value, ttlSeconds }),

    setTtl: (configId: string, db: number, key: string, ttlSeconds: number | null) =>
      call<void>('set-ttl', { configId, db, key, ttlSeconds }),

    deleteKeys: (configId: string, db: number, keys: string[]) =>
      call<number>('delete-keys', { configId, db, keys }),

    renameKey: (configId: string, db: number, oldKey: string, newKey: string) =>
      call<void>('rename-key', { configId, db, oldKey, newKey }),

    /** Run an arbitrary command. Backs the CLI console and the key editors' mutations. */
    exec: (configId: string, db: number, args: string[]) =>
      call<RedisReply>('exec', { configId, db, args }),

    memoryUsage: (configId: string, db: number, key: string) =>
      call<number | null>('memory-usage', { configId, db, key }),

    // ── Pub/Sub ───────────────────────────────────────────────────────────────

    /**
     * Subscribe to channels/patterns via the sidecar's STREAM method — the
     * first event carries `{ type: 'subscribed', subscriptionId }` (an id the
     * sidecar generates internally, distinct from the JSONL request id), every
     * following event carries `{ type: 'message', ... }` and is forwarded to
     * `onMessage`. Never resolves with `done: true` on its own — call
     * `.stop()` to end it.
     *
     * A subscribe-time failure (bad config, connection refused/timeout) is
     * sent by the sidecar as a THIRD event shape, `{ type: 'error', message }`
     * — deliberately NOT as a protocol-level `ServiceResponse.error`, because
     * `service_host.rs`'s `dispatch()` silently drops an `error` response
     * routed to a Stream waiter (no `EventSink` variant carries an error out;
     * see its doc comment). Wrapping the failure as a normal stream event lets
     * it reach here, so this promise properly WAITS for either `subscribed`
     * or `error` before settling — resolving early (before either arrives)
     * would make every connection failure look like a silent no-op to the
     * caller, exactly the bug this shape avoids.
     *
     * `.stop()` does the two mandatory steps in order: (1) tell the sidecar to
     * actually stop publishing via the one-shot `unsubscribe` method (only if
     * a `subscriptionId` was received), THEN (2) stop the host-side stream
     * registration (`ServiceSubscription.stop()`) — `service_stream_stop`
     * only unregisters the host waiter, it does not signal the sidecar (see
     * platform-plugin-architecture.md's Tier B section).
     */
    pubsubSubscribe: async (
      configId: string,
      channels: string[],
      patterns: string[],
      onMessage: (msg: PubSubMessage) => void,
    ): Promise<{ stop(): Promise<void> }> => {
      let subscriptionId: string | null = null;
      let settleReady: (() => void) | null = null;
      let settleFailed: ((e: Error) => void) | null = null;
      const ready = new Promise<void>((resolve, reject) => {
        settleReady = resolve;
        settleFailed = reject;
      });

      const subscription = await sdk.service.stream<{
        type: string;
        subscriptionId?: string;
        message?: string;
        channel?: string;
        pattern?: string | null;
        payload?: string;
      }>(
        'pubsub-subscribe',
        (event) => {
          if (event.type === 'subscribed') {
            subscriptionId = event.subscriptionId ?? null;
            settleReady?.();
            return;
          }
          if (event.type === 'error') {
            settleFailed?.(new Error(event.message ?? 'Subscribe failed'));
            return;
          }
          if (event.type === 'message') {
            onMessage({ channel: event.channel ?? '', pattern: event.pattern ?? null, payload: event.payload ?? '' });
          }
        },
        { configId, channels, patterns },
      );

      try {
        await ready;
      } catch (e) {
        // Đăng ký phía host đã lỡ mở (sdk.service.stream ở trên thành công) —
        // dọn nó đi trước khi báo lỗi lên, không để lại một stream mồ côi
        // không ai còn đọc.
        await subscription.stop().catch(() => {});
        throw e;
      }

      return {
        async stop() {
          if (subscriptionId) {
            await call<void>('unsubscribe', { subscriptionId }).catch(() => {});
          }
          await subscription.stop();
        },
      };
    },

    publish: (configId: string, channel: string, message: string) =>
      call<number>('publish', { configId, channel, message }),

    // ── Server admin ──────────────────────────────────────────────────────────

    clientList: (configId: string) =>
      call<ClientInfo[]>('client-list', { configId }),

    slowlog: (configId: string, count: number) =>
      call<SlowLogEntry[]>('slowlog', { configId, count }),

    configGet: (configId: string, pattern: string) =>
      call<[string, string][]>('config-get', { configId, pattern }),

    configSet: (configId: string, param: string, value: string) =>
      call<void>('config-set', { configId, param, value }),
  };
}

export type RedisApi = ReturnType<typeof createRedisApi>;
