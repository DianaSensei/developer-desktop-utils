import { invoke, Channel } from '@tauri-apps/api/core';

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
  amqpOnly: false,
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

// ── Invoke wrappers ───────────────────────────────────────────────────────────

export const rabbitApi = {
  listConfigs: () => invoke<RabbitConnection[]>('rabbit_list_configs'),
  saveConfig: (config: RabbitConnection) =>
    invoke<RabbitConnection>('rabbit_save_config', { config }),
  deleteConfig: (configId: string) =>
    invoke<void>('rabbit_delete_config', { configId }),

  /** Publish over AMQP with full properties, optional mandatory flag and publisher confirms. */
  publish: (args: PublishArgs) =>
    invoke<PublishOutcome>('rabbit_publish', {
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
    invoke<RpcReply>('rabbit_rpc_call', {
      configId: args.configId,
      exchange: args.exchange,
      routingKey: args.routingKey,
      payload: args.payload,
      correlationId: args.correlationId ?? null,
      contentType: args.contentType ?? null,
      headers: args.headers ?? null,
      timeoutMs: args.timeoutMs,
    }),

  /** Start a live consumer; deliveries stream to `onMessage`. Returns the consumer id. */
  consumeStart: (
    args: { configId: string; queue: string; ackMode: ConsumeAckMode; prefetch: number; reply?: ReplyOptions | null },
    onMessage: Channel<ConsumedMessage>,
  ) =>
    invoke<string>('rabbit_consume_start', {
      configId: args.configId,
      queue: args.queue,
      ackMode: args.ackMode,
      prefetch: args.prefetch,
      reply: args.reply ?? null,
      onMessage,
    }),

  consumeStop: (consumerId: string) =>
    invoke<void>('rabbit_consume_stop', { consumerId }),

  // ── AMQP-only topology (brokers without the management HTTP API) ────────────

  /** Open + close an AMQP connection to verify a (possibly unsaved) profile. */
  amqpTest: (config: RabbitConnection) => invoke<void>('rabbit_amqp_test', { config }),

  /** Passive-declare each named queue → existence + live message/consumer counts. */
  amqpQueuesInfo: (configId: string, names: string[]) =>
    invoke<QueueAmqpInfo[]>('rabbit_amqp_queues_info', { configId, names }),

  /** Passive-declare each named exchange → existence. */
  amqpExchangesInfo: (configId: string, names: string[]) =>
    invoke<ExchangeAmqpInfo[]>('rabbit_amqp_exchanges_info', { configId, names }),

  /** Declare a queue over AMQP. */
  amqpDeclareQueue: (configId: string, name: string, durable: boolean, autoDelete: boolean) =>
    invoke<void>('rabbit_amqp_declare_queue', { configId, name, durable, autoDelete }),

  /** Declare an exchange over AMQP. */
  amqpDeclareExchange: (
    configId: string, name: string, kind: string, durable: boolean, autoDelete: boolean, internal: boolean,
  ) =>
    invoke<void>('rabbit_amqp_declare_exchange', { configId, name, kind, durable, autoDelete, internal }),

  /** Bind a queue to an exchange over AMQP. */
  amqpBindQueue: (configId: string, queue: string, exchange: string, routingKey: string) =>
    invoke<void>('rabbit_amqp_bind_queue', { configId, queue, exchange, routingKey }),
};
