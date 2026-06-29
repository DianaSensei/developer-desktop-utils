# Local Kafka for testing the DevTool Kafka Explorer

A single-node Kafka broker (KRaft mode — no ZooKeeper) plus a producer and a
consumer group that generate continuous traffic, so every Kafka Explorer feature
has live data to show.

## Start

```bash
cd testing/kafka
docker compose up --build
```

Then in the tool add a broker with **bootstrap servers** `localhost:9092`
(plaintext, no auth).

Stop and wipe everything:

```bash
docker compose down            # stop
docker compose down -v         # stop + remove data
```

## What's created

| Topic | Partitions | Traffic | Use it to test |
|-------|-----------|---------|----------------|
| `demo.events` | 3 | JSON, **keyed** (one of 50 users) | realtime consume across partitions; key-based routing; consumer group lag |
| `demo.json` | 1 | plain JSON values | the **JSON** value format |
| `demo.bytes` | 1 | raw binary (`struct`-packed) | the **Hex** value format (non-UTF8) |
| `demo.rpc` | 1 | empty | create/produce by hand |

A consumer group **`demo-consumers`** continuously consumes `demo.events`.

## Test cases → steps in the tool

| Goal | Steps |
|------|-------|
| **Find / create a topic** | Left panel → Topics: search `demo`. Create one with **New topic**. |
| **View messages in realtime** | Open a topic → **Consume** (or the left-nav **Consume**). Start on `demo.events` with **New only** and watch messages stream in. |
| **Search messages** | In the consumer card, type in the search box (e.g. a user id, `purchase`, a partition/offset). |
| **JSON / Plain / Hex** | Consume `demo.json` → **JSON**. Consume `demo.bytes` → **Hex** (binary renders as a hex dump). |
| **Produce a message** | Open a topic → **Produce** tab → send a single or batch message. |
| **Which groups consume a topic** | Open `demo.events` → **Consumers** tab → see `demo-consumers` and per-partition lag. |
| **Which topics a group consumes** | Click `demo-consumers` (Consumers tab or the Groups list) → the group view lists `demo.events` and its assignments. |
| **Replay from the beginning** | Start a realtime consumer with **Beginning** instead of **New only**. |

## Notes

- The realtime consumer in the tool is **anonymous**: it does not join a consumer
  group or commit offsets, so it never affects `demo-consumers`' lag.
- The broker advertises `localhost:9092` to your host and `kafka:29092` inside the
  compose network — only point the tool at **`localhost:9092`**.
- Single node, replication factor 1 — not a production topology, just enough to
  exercise the tool.
