// RabbitMQ Management HTTP API client.
//
// All calls go through the Tauri HTTP plugin (`@tauri-apps/plugin-http`) so the
// request is made from Rust — no browser `Origin` header and no CORS, the same
// pattern as `src/lib/network.ts`. The Management API uses HTTP Basic auth; we
// build the `Authorization` header from the stored connection profile. This is a
// desktop-only tool (the web build has no Tauri host to proxy through).

import type {
  RabbitConnection,
  Overview,
  NodeInfo,
  VHost,
  QueueInfo,
  ExchangeInfo,
  BindingInfo,
  ConnectionRow,
  ChannelRow,
} from './types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

/** Base API URL, e.g. `http://localhost:15672/api`. */
function baseUrl(conn: RabbitConnection): string {
  const scheme = conn.useTls ? 'https' : 'http';
  return `${scheme}://${conn.host}:${conn.port}/api`;
}

function authHeader(conn: RabbitConnection): string {
  // btoa handles the base64; credentials are sent on every request as Basic auth.
  return 'Basic ' + btoa(`${conn.username}:${conn.password}`);
}

/** vhost "/" → "%2F"; any name segment must be URL-encoded for the path. */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// Fast list queries: fetch only the columns the list tables render and skip the
// broker's expensive per-object rate statistics. Keep these in sync with the
// fields read by QueueListView / ExchangeListView.
const QUEUE_LIST_QUERY = [
  'disable_stats=true',
  'enable_queue_totals=true',
  'columns=name,messages,messages_ready,messages_unacknowledged,consumers,state',
].join('&');
const EXCHANGE_LIST_QUERY = 'disable_stats=true&columns=name,type,durable,internal';

async function request<T>(
  conn: RabbitConnection,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${baseUrl(conn)}${path}`;
  let res: Response;
  try {
    res = await httpFetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(conn),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    throw new Error(
      `Could not reach ${conn.host}:${conn.port}. Is the RabbitMQ management plugin enabled? (${String(e)})`,
    );
  }

  if (res.status === 401) {
    throw new Error('Authentication failed — check the username and password.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.reason || parsed.error || body;
    } catch {
      /* keep raw body */
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  // DELETE / PUT often return empty bodies.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const rabbitMgmt = {
  // ── Overview ────────────────────────────────────────────────────────────
  overview: (c: RabbitConnection) => request<Overview>(c, '/overview'),
  nodes: (c: RabbitConnection) => request<NodeInfo[]>(c, '/nodes'),
  vhosts: (c: RabbitConnection) => request<VHost[]>(c, '/vhosts'),

  /** Lightweight connectivity check used by the connection form. */
  testConnection: (c: RabbitConnection) => request<Overview>(c, '/overview'),

  // ── Queues ──────────────────────────────────────────────────────────────
  // The list only needs a few columns. By default `/api/queues` returns every
  // queue with full per-queue statistics (rates, message_stats, consumer/GC
  // details) which the broker computes and serializes — very slow on large or
  // busy clusters. `columns` trims the payload to what the table shows, and
  // `disable_stats` + `enable_queue_totals` skip the rate machinery while still
  // returning the message/consumer counts.
  listQueues: (c: RabbitConnection) =>
    request<QueueInfo[]>(c, `/queues/${enc(c.vhost)}?${QUEUE_LIST_QUERY}`),
  queue: (c: RabbitConnection, name: string) =>
    request<QueueInfo>(c, `/queues/${enc(c.vhost)}/${enc(name)}`),
  queueBindings: (c: RabbitConnection, name: string) =>
    request<BindingInfo[]>(c, `/queues/${enc(c.vhost)}/${enc(name)}/bindings`),
  createQueue: (c: RabbitConnection, name: string, durable: boolean) =>
    request<void>(c, `/queues/${enc(c.vhost)}/${enc(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ durable, auto_delete: false, arguments: {} }),
    }),

  // ── Exchanges ─────────────────────────────────────────────────────────────
  listExchanges: (c: RabbitConnection) =>
    request<ExchangeInfo[]>(c, `/exchanges/${enc(c.vhost)}?${EXCHANGE_LIST_QUERY}`),
  exchange: (c: RabbitConnection, name: string) =>
    request<ExchangeInfo>(c, `/exchanges/${enc(c.vhost)}/${enc(name)}`),
  exchangeBindings: (c: RabbitConnection, name: string) =>
    request<BindingInfo[]>(c, `/exchanges/${enc(c.vhost)}/${enc(name)}/bindings/source`),
  createExchange: (
    c: RabbitConnection,
    name: string,
    type: string,
    durable: boolean,
    autoDelete = false,
    internal = false,
  ) =>
    request<void>(c, `/exchanges/${enc(c.vhost)}/${enc(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ type, durable, auto_delete: autoDelete, internal, arguments: {} }),
    }),

  // ── Bindings ──────────────────────────────────────────────────────────────
  /** Bind a source exchange to a destination queue ('q') or exchange ('e'). */
  createBinding: (
    c: RabbitConnection,
    source: string,
    destinationType: 'q' | 'e',
    destination: string,
    routingKey: string,
  ) =>
    request<void>(
      c,
      `/bindings/${enc(c.vhost)}/e/${enc(source)}/${destinationType}/${enc(destination)}`,
      { method: 'POST', body: JSON.stringify({ routing_key: routingKey, arguments: {} }) },
    ),

  // Publishing moved to AMQP — see `rabbitApi.publish` (rabbit_publish) for full
  // properties, mandatory-return and publisher confirms.

  // ── Connections & channels ──────────────────────────────────────────────
  connections: (c: RabbitConnection) => request<ConnectionRow[]>(c, '/connections'),
  channels: (c: RabbitConnection) => request<ChannelRow[]>(c, '/channels'),
};
