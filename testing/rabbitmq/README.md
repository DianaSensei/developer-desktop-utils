# RabbitMQ test stack

A self-contained Docker Compose stack for exercising the DevTool **RabbitMQ** tool:
a broker plus four small Python workers that generate live traffic.

## Run

```bash
cd testing/rabbitmq
docker compose up --build      # Ctrl-C to stop
docker compose down            # stop & remove containers (add -v to wipe broker data)
```

## Connect from DevTool

Enable the **RabbitMQ** tool in Settings, then add a connection:

| Field | Value |
|-------|-------|
| Host | `localhost` |
| Port | `15672` |
| Virtual host | `/` |
| Username | `guest` |
| Password | `guest` |
| TLS | off |

The management web UI is also at <http://localhost:15672> (guest/guest) for comparison.

## What's running

| Service | What it does | What you'll see in the tool |
|---------|--------------|------------------------------|
| `rabbitmq` | Broker + management API | Overview rates/totals, Connections, Channels |
| `producer` | Publishes JSON to `demo.work` every 2s | `demo.work` grows; non-zero publish rate |
| `consumer` | Consumes `demo.work` (1s work, manual ack) | Ready/unacked counts move; deliver/ack rates |
| `rpc-server` | Serves `rpc_queue`, replies to `reply_to` | `rpc_queue` + a transient `amq.gen-*` reply queue |
| `rpc-client` | Sends an RPC request every 5s | Request/response traffic with correlation IDs |
| `fanout-publisher` | Publishes to `demo.fanout` every 3s | `demo.fanout.a` + `demo.fanout.b` both fill |
| `topic-publisher` | Publishes to `demo.topic` with rotating keys | `demo.topic.all` (all) + `demo.topic.orders` (`orders.*`) |
| `spring-rpc` | **Spring Boot** `@RabbitListener` responder + a `convertSendAndReceive` self-test every 10s | `spring.rpc.exchange`, `spring.rpc.requests`, self-test round-trips |

## Preloaded topology (`definitions.json`)

Loaded on startup so every routing type has a ready target:

| Exchange | Type | Bound queue(s) | Routing key |
|----------|------|----------------|-------------|
| `demo.direct` | direct | `demo.direct.q` | `rk` |
| `demo.fanout` | fanout | `demo.fanout.a`, `demo.fanout.b` | (any) |
| `demo.topic` | topic | `demo.topic.all`, `demo.topic.orders` | `#`, `orders.*` |
| `demo.headers` | headers | `demo.headers.q` | match `type=report, format=pdf` |
| `demo.dlx` | direct | `demo.dlq` | `dead` |

`demo.ttl` has a 10s message-TTL and dead-letters to `demo.dlx` → `demo.dlq`. A second vhost **`demo`** holds `demo.direct` → `demo.q` (`rk`) for testing vhost switching.

> The first `docker compose up --build` compiles the Spring app with Maven, so it
> takes a few minutes and downloads dependencies. Subsequent builds are cached.

## Things to try

- Open **`demo.work`** → **Get messages**: peeks the queue and requeues (nothing consumed).
- Stop the consumer (`docker compose stop consumer`) and watch `demo.work` back up.
- **Publish** a message to `demo.work` from the tool and watch the consumer log pick it up.
- Open the **amq.default** exchange → **Publish** with routing key `demo.work` (same result, via the exchange).
- **Connections / Channels** tabs show the live producer/consumer/RPC links.

## Test Spring-style request/response from the tool

The `spring-rpc` service is a real Spring AMQP responder. The tool's
**Request / Response** panel does true direct reply-to (`amq.rabbitmq.reply-to`)
over AMQP, so this is now a one-step test:

1. Open **Request / Response** in the left nav.
2. Set:
   - **Exchange**: `spring.rpc.exchange`
   - **Routing key**: `rpc.request`
   - **Request payload**: `hello world`
   - **Content type**: `text/plain` (this demo uses String payloads)
3. **Send & await reply** → you'll get `reply to 'hello world' -> HELLO WORLD`
   with the elapsed time and correlation id.

The panel uses the connection's **AMQP port** (default 5672), so make sure that's
set on the connection. Watch it server-side with `docker compose logs -f spring-rpc`.

> **JSON DTOs?** This demo uses plain String payloads so no `__TypeId__` is needed.
> If your real services use `Jackson2JsonMessageConverter` with type info, add a
> header like `{"__TypeId__": "com.example.YourRequest"}` in the Request/Response
> panel's Headers field.

You can also do it the manual way (publish with a named reply queue + **Get
messages**) via the Publish tab's **Message properties** — useful if you want to
inspect the raw request/reply messages.

## Test cases (drive these from the tool)

| Scenario | How |
|----------|-----|
| **Direct** routing | Open exchange `demo.direct` → Publish, routing key `rk`. Consume `demo.direct.q` to see it. |
| **Fanout** | Publish to `demo.fanout` (any key). Both `demo.fanout.a` and `demo.fanout.b` receive a copy. |
| **Topic** | Publish to `demo.topic`, key `orders.created` → lands in both `demo.topic.all` and `demo.topic.orders`; key `users.signup` → only `demo.topic.all`. |
| **Headers** | Publish to `demo.headers` with headers `{"type":"report","format":"pdf"}` → routes to `demo.headers.q`. |
| **Mandatory / unroutable** | Publish to `demo.direct` with a key nothing is bound to **and Mandatory on** → the tool reports "Unroutable — returned". |
| **Publisher confirm** | Any publish with **Publisher confirm on** → "Published & confirmed". |
| **Peek vs consume** | On a queue's **Consume** tab: *Peek* leaves messages (Ready count stays); *Consume* drains them. |
| **Dead-letter / TTL** | Publish to `demo.ttl` (default exchange, key `demo.ttl`), wait 10s → the message dead-letters into `demo.dlq`. |
| **Request/Response** | Use the Request/Response panel against `spring.rpc.exchange` / `rpc.request`. |
| **vhost** | Add a connection with vhost `demo` and exercise `demo.direct` → `demo.q`. |

## Run the Rust integration tests

The `#[ignore]`d broker integration tests in `src-tauri/tests/rabbit_it.rs` run against this stack. With the broker up:

```bash
cd ../../src-tauri
RABBIT_IT_AMQP="amqp://guest:guest@localhost:5672/%2f" \
RABBIT_IT_MGMT="http://guest:guest@localhost:15672" \
  cargo test --test rabbit_it -- --ignored
```

They create temp queues/exchanges, publish/consume/RPC, and clean up after themselves.
