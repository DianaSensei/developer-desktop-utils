import type { PluginSdk } from '@/platform';

// ── Connection profile (persisted via Rust to the app-data dir) ───────────────

export interface RabbitConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  vhost: string;
  username: string;
  password: string;
  useTls: boolean;
  /** AMQP port (default 5672) — used by publish / consume / request-response. */
  amqpPort: number;
  /**
   * Extra AMQP endpoints to try, in order, if the primary host is unreachable
   * (HA clusters with no load balancer). Each entry is `host` or `host:port`.
   */
  extraHosts?: string[] | null;
  /** Custom CA certificate (PEM) to trust — for self-signed / private brokers. */
  tlsCaPem?: string | null;
  /** Client identity for mutual-TLS: a PKCS#12 bundle, base64-encoded. */
  clientPkcs12B64?: string | null;
  clientPkcs12Password?: string | null;
  /** AMQP heartbeat interval in seconds. */
  heartbeat?: number | null;
  /** Client-provided connection name (shows in the broker's Connections list). */
  connectionName?: string | null;
  /**
   * AMQP-only mode: the broker exposes no management HTTP API, so the tool works
   * off typed queue/exchange names (passive declare for counts) and declares/binds
   * over AMQP instead of the REST API. Browse-all lists, Overview and Connections
   * are unavailable in this mode (AMQP can't enumerate them).
   */
  amqpOnly?: boolean;
}

export const EMPTY_CONNECTION: RabbitConnection = {
  id: '',
  name: '',
  host: 'localhost',
  port: 15672,
  vhost: '/',
  username: 'guest',
  password: 'guest',
  useTls: false,
  amqpPort: 5672,
  extraHosts: null,
  tlsCaPem: null,
  clientPkcs12B64: null,
  clientPkcs12Password: null,
  heartbeat: 30,
  connectionName: null,
  // AMQP is the simple default; the management API is opt-in (see ConnectionForm).
  amqpOnly: true,
};

// ── AMQP-only topology probes (no management API) ─────────────────────────────

/** Result of a passive queue declare: existence + live counts for a named queue. */
export interface QueueAmqpInfo {
  name: string;
  exists: boolean;
  messages: number | null;
  consumers: number | null;
  error: string | null;
}

/** Result of a passive exchange declare: whether the named exchange exists. */
export interface ExchangeAmqpInfo {
  name: string;
  exists: boolean;
  error: string | null;
}

// ── Management API response shapes (only the fields the UI reads) ─────────────

export interface Overview {
  rabbitmq_version?: string;
  erlang_version?: string;
  cluster_name?: string;
  product_name?: string;
  product_version?: string;
  message_stats?: MessageStats;
  queue_totals?: {
    messages?: number;
    messages_ready?: number;
    messages_unacknowledged?: number;
  };
  object_totals?: {
    connections?: number;
    channels?: number;
    exchanges?: number;
    queues?: number;
    consumers?: number;
  };
}

export interface RateSample {
  rate?: number;
}

export interface MessageStats {
  publish?: number;
  publish_details?: RateSample;
  deliver_get?: number;
  deliver_get_details?: RateSample;
  ack?: number;
  ack_details?: RateSample;
  redeliver?: number;
  redeliver_details?: RateSample;
}

export interface NodeInfo {
  name: string;
  running?: boolean;
  type?: string;
  mem_used?: number;
  mem_limit?: number;
  disk_free?: number;
  disk_free_limit?: number;
  fd_used?: number;
  fd_total?: number;
  sockets_used?: number;
  sockets_total?: number;
  uptime?: number;
  proc_used?: number;
  proc_total?: number;
}

export interface VHost {
  name: string;
}

export interface QueueInfo {
  name: string;
  vhost: string;
  state?: string;
  durable?: boolean;
  auto_delete?: boolean;
  exclusive?: boolean;
  node?: string;
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
  consumers?: number;
  memory?: number;
  message_stats?: MessageStats;
  arguments?: Record<string, unknown>;
}

export interface ExchangeInfo {
  name: string;
  vhost: string;
  type?: string;
  durable?: boolean;
  auto_delete?: boolean;
  internal?: boolean;
  message_stats?: MessageStats;
  arguments?: Record<string, unknown>;
}

export interface BindingInfo {
  source: string;
  vhost: string;
  destination: string;
  destination_type: string;
  routing_key: string;
  properties_key?: string;
  arguments?: Record<string, unknown>;
}

export interface ConnectionRow {
  name: string;
  user?: string;
  state?: string;
  channels?: number;
  protocol?: string;
  peer_host?: string;
  peer_port?: number;
  ssl?: boolean;
  connected_at?: number;
  recv_oct?: number;
  send_oct?: number;
  client_properties?: { connection_name?: string; platform?: string; product?: string };
}

export interface ChannelRow {
  name: string;
  user?: string;
  number?: number;
  state?: string;
  consumer_count?: number;
  messages_unacknowledged?: number;
  messages_unconfirmed?: number;
  prefetch_count?: number;
  connection_details?: { name?: string; peer_host?: string };
}

/** Full AMQP message properties for a publish. Empty/undefined fields are omitted. */
export interface MessageProperties {
  contentType?: string;
  contentEncoding?: string;
  correlationId?: string;
  replyTo?: string;
  messageId?: string;
  type?: string;
  appId?: string;
  userId?: string;
  expiration?: string;
  priority?: number;
  persistent?: boolean;
  headers?: Record<string, string>;
}

/** Result of an AMQP publish with confirms / mandatory. */
export interface PublishOutcome {
  confirmed: boolean;
  routed: boolean;
  returnReason: string | null;
}

export interface PublishArgs {
  configId: string;
  exchange: string;
  routingKey: string;
  payload: string;
  properties: MessageProperties;
  mandatory: boolean;
  confirm: boolean;
}

/** A message delivered to a live consumer. */
export interface ConsumedMessage {
  payload: string;
  exchange: string;
  routingKey: string;
  redelivered: boolean;
  deliveryTag: number;
  correlationId: string | null;
  contentType: string | null;
  messageId: string | null;
  headers: Record<string, string>;
}

export type ConsumeAckMode = 'peek' | 'consume' | 'respond';

/** Auto-reply config for a "respond" consumer (tool acts as an RPC server). */
export interface ReplyOptions {
  echo: boolean;
  payload: string;
  contentType?: string;
}

/** Reply to a Request/Response (direct reply-to) call. */
export interface RpcReply {
  payload: string;
  correlationId: string | null;
  contentType: string | null;
}

export interface RpcCallArgs {
  configId: string;
  exchange: string;
  routingKey: string;
  payload: string;
  correlationId?: string | null;
  contentType?: string | null;
  headers?: Record<string, string> | null;
  timeoutMs: number;
}

// ── Service (sidecar) wrappers ─────────────────────────────────────────────────

/** Trả về từ `consumeStart` — `.stop()` gói cả hai bước bắt buộc: báo sidecar
 *  dừng qua `consume-stop` (nếu đã nhận được `subscriptionId`) rồi mới gỡ
 *  đăng ký phía host, đúng thứ tự `pubsubSubscribe` của Redis / `logsStart`/
 *  `statsStart` của Container đã làm. */
export interface RabbitConsumeSubscription {
  stop(): Promise<void>;
}

/**
 * Lớp lệnh RabbitMQ, dựng theo `sdk.service` (Tier B — sidecar
 * `devtool-svc-rabbit`) thay vì gọi thẳng `invoke`. Nhờ vậy allowlist
 * `service.methods` trong manifest có hiệu lực thật — một method gõ sai hay
 * ngoài danh sách bị chặn ngay và ghi vào nhật ký, thay vì lặng lẽ đi thẳng
 * xuống sidecar.
 *
 * Method quản lý HTTP (overview/queues/exchanges/connections/...) KHÔNG nằm
 * ở đây — chúng đi qua `sdk.http.fetch` tới REST API quản trị của broker (xem
 * `api.ts`), không phải qua sidecar.
 *
 * Dùng qua `useRabbitApi()` (xem api.ts); factory để lộ ra đây chỉ cho test và
 * cho code không phải React.
 */
export function createRabbitApi(sdk: PluginSdk) {
  const call = <T,>(method: string, params?: Record<string, unknown>) =>
    sdk.service.call<T>(method, params);

  return {
    listConfigs: () => call<RabbitConnection[]>('list-configs'),
    saveConfig: (config: RabbitConnection) => call<RabbitConnection>('save-config', { config }),
    deleteConfig: (configId: string) => call<void>('delete-config', { configId }),

    /** Publish over AMQP with full properties, optional mandatory flag and publisher confirms. */
    publish: (args: PublishArgs) =>
      call<PublishOutcome>('publish', {
        configId: args.configId,
        exchange: args.exchange,
        routingKey: args.routingKey,
        payload: args.payload,
        properties: args.properties,
        mandatory: args.mandatory,
        confirm: args.confirm,
      }),

    /** Request/response via AMQP direct reply-to. Resolves with the reply or rejects on timeout. */
    rpcCall: (args: RpcCallArgs) =>
      call<RpcReply>('rpc-call', {
        configId: args.configId,
        exchange: args.exchange,
        routingKey: args.routingKey,
        payload: args.payload,
        correlationId: args.correlationId ?? null,
        contentType: args.contentType ?? null,
        headers: args.headers ?? null,
        timeoutMs: args.timeoutMs,
      }),

    /**
     * Start a live consumer via the sidecar's STREAM method `consume-start` —
     * mirrors `createRedisApi.pubsubSubscribe`: the first event carries
     * `{ type: 'subscribed', subscriptionId }` (the sidecar's internal
     * consumer id, distinct from the JSONL request id), every following
     * `{ type: 'message', ...ConsumedMessage }` event is forwarded to
     * `onMessage`. A subscribe-time failure (bad config, connection refused,
     * missing queue) arrives as a THIRD event shape, `{ type: 'error',
     * message }` — deliberately not a protocol-level `ServiceResponse.error`
     * (see `send_stream_error`'s doc comment in devtool-svc-rabbit.rs; a
     * `Waiter::Stream` silently drops that). This promise properly WAITS for
     * either `subscribed` or `error` before settling.
     *
     * `.stop()` does the two mandatory steps in order: (1) tell the sidecar
     * to actually stop the consumer via the one-shot `consume-stop` method
     * (only if a `subscriptionId` was received), THEN (2) stop the host-side
     * stream registration — `service_stream_stop` only unregisters the host
     * waiter, it does not signal the sidecar.
     */
    consumeStart: async (
      args: { configId: string; queue: string; ackMode: ConsumeAckMode; prefetch: number; reply?: ReplyOptions | null },
      onMessage: (msg: ConsumedMessage) => void,
    ): Promise<RabbitConsumeSubscription> => {
      let subscriptionId: string | null = null;
      let settleReady: (() => void) | null = null;
      let settleFailed: ((e: Error) => void) | null = null;
      const ready = new Promise<void>((resolve, reject) => {
        settleReady = resolve;
        settleFailed = reject;
      });

      const subscription = await sdk.service.stream<
        { type: string; subscriptionId?: string; message?: string } & Partial<ConsumedMessage>
      >(
        'consume-start',
        (event) => {
          if (event.type === 'subscribed') {
            subscriptionId = event.subscriptionId ?? null;
            settleReady?.();
            return;
          }
          if (event.type === 'error') {
            settleFailed?.(new Error(event.message ?? 'Consume failed'));
            return;
          }
          if (event.type === 'message') {
            onMessage({
              payload: event.payload ?? '',
              exchange: event.exchange ?? '',
              routingKey: event.routingKey ?? '',
              redelivered: event.redelivered ?? false,
              deliveryTag: event.deliveryTag ?? 0,
              correlationId: event.correlationId ?? null,
              contentType: event.contentType ?? null,
              messageId: event.messageId ?? null,
              headers: event.headers ?? {},
            });
          }
        },
        {
          configId: args.configId,
          queue: args.queue,
          ackMode: args.ackMode,
          prefetch: args.prefetch,
          reply: args.reply ?? null,
        },
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
            await call<void>('consume-stop', { consumerId: subscriptionId }).catch(() => {});
          }
          await subscription.stop();
        },
      };
    },

    // ── AMQP-only topology (brokers without the management HTTP API) ────────────

    /** Open + close an AMQP connection to verify a (possibly unsaved) profile. */
    amqpTest: (config: RabbitConnection) => call<void>('amqp-test', { config }),

    /** Passive-declare each named queue → existence + live message/consumer counts. */
    amqpQueuesInfo: (configId: string, names: string[]) =>
      call<QueueAmqpInfo[]>('amqp-queues-info', { configId, names }),

    /** Passive-declare each named exchange → existence. */
    amqpExchangesInfo: (configId: string, names: string[]) =>
      call<ExchangeAmqpInfo[]>('amqp-exchanges-info', { configId, names }),

    /** Declare a queue over AMQP. */
    amqpDeclareQueue: (configId: string, name: string, durable: boolean, autoDelete: boolean) =>
      call<void>('amqp-declare-queue', { configId, name, durable, autoDelete }),

    /** Declare an exchange over AMQP. */
    amqpDeclareExchange: (
      configId: string, name: string, kind: string, durable: boolean, autoDelete: boolean, internal: boolean,
    ) =>
      call<void>('amqp-declare-exchange', { configId, name, kind, durable, autoDelete, internal }),

    /** Bind a queue to an exchange over AMQP. */
    amqpBindQueue: (configId: string, queue: string, exchange: string, routingKey: string) =>
      call<void>('amqp-bind-queue', { configId, queue, exchange, routingKey }),
  };
}

export type RabbitApi = ReturnType<typeof createRabbitApi>;
