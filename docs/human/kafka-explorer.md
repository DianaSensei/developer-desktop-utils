# Kafka Explorer — How It Works

This document describes every interaction Kafka Explorer makes with your Kafka cluster: what protocol calls are issued, when they happen, and their potential impact. Read this before connecting to a production cluster.

---

## Connection model

**There is no persistent connection.** Every operation opens one TCP connection to your broker and closes it when the operation finishes. The first request on that connection is a short MetadataRequest **probe** (to verify the host is a Kafka broker — not ZooKeeper or another port); the **same connection is then reused** for the actual command. Each read-path action therefore makes a single TCP connection.

The `fetch_messages`, `produce`, and create/delete topic operations use [rskafka](https://github.com/influxdata/rskafka) as the client library, which manages its own connection lifecycle per call.

The client identifies itself to brokers with the client ID **`devtool`**. You will see this in broker logs and JMX metrics.

**No background polling.** Data loads automatically when you open a view — topic messages, the Consumers tab, group details — and refreshes only when you navigate or click Refresh. Nothing polls or holds a subscription open between actions.

**Security protocol.** Each broker profile picks one of the four standard Kafka `security.protocol` values: `PLAINTEXT` (default, no auth, unencrypted), `SSL` (TLS only), `SASL_PLAINTEXT` (username/password, unencrypted), or `SASL_SSL` (username/password over TLS). SASL supports the `PLAIN`, `SCRAM-SHA-256`, and `SCRAM-SHA-512` mechanisms. TLS trusts the OS certificate store by default, or a pasted custom/self-signed CA certificate (PEM) when set on the broker profile. Credentials and any custom CA are stored in the same on-device `kafka-brokers.json` file as the rest of the broker profile.

> ⚠ **`PLAINTEXT` connections are unencrypted with no authentication.** Only use it against brokers that don't require encryption or credentials — switch the broker's security protocol to `SSL` / `SASL_PLAINTEXT` / `SASL_SSL` otherwise.

---

## Operations reference

Each entry below lists: **when it fires**, **what Kafka API calls are made**, and **the impact**.

### ⬡ Broker selection

**When:** user selects a broker in the left panel, or clicks "Test connection."

| Call | Kafka API | Direction |
|---|---|---|
| Probe / test connection | MetadataRequest v0 (API 3) | Read |

- 1 TCP connection. The probe MetadataRequest doubles as the connectivity check.
- Reads broker list and topic names (payload is small).
- **No data is written. No consumer group is created.**

---

### ⬡ Topic list

**When:** a broker is selected (fires automatically) or the user clicks Refresh.

| Call | Kafka API | Direction |
|---|---|---|
| Fetch all topics | MetadataRequest v0 (empty topic filter = all) | Read |

- 1 TCP connection.
- Returns all topic names, partition counts, and replication factors.
- **Scales with total number of topics on the cluster.** A cluster with thousands of topics returns a proportionally larger metadata payload.

---

### ⬡ Topic details (opening a topic)

**When:** user clicks a topic in the left panel.

| Call | Kafka API | Direction |
|---|---|---|
| Topic partition metadata | MetadataRequest v0 (single topic) | Read |
| Earliest offsets (all partitions) | ListOffsetsRequest v0 (API 2), timestamp=−2 | Read |
| Latest offsets (all partitions) | ListOffsetsRequest v0 (API 2), timestamp=−1 | Read |

- 1 TCP connection. The two ListOffsets calls each cover all partitions in one request.
- **No data is written. No consumer group is created.**

---

### ⬡ Messages tab — Fetch

**When:** the latest page **loads automatically** when you open a topic (tail mode). The *From offset*, *Range*, and *Since time* modes load when you click **Fetch**.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client | New TCP connection to broker | — |
| (Tail mode only) Resolve tail offset | get high-watermark | Read |
| Fetch records | FetchRequest — up to **10 MB** per call | Read |

- 1 rskafka client connection, 1–2 Kafka API calls.
- **Up to 10 MB of message data is pulled per fetch.** On high-throughput topics with large messages this can be a meaningful read. The requested message count is clamped (UI: *Max fetch messages* setting; server-side hard cap: 100,000) so a bad value can't trigger a runaway read.
- **No consumer group offset is committed.** Kafka Explorer does not create a consumer group, does not register a group ID, and does not advance any consumer position. Your existing consumer groups are not affected.
- **Messages are read-only** — no data is modified or deleted.

---

### ⬡ Messages tab — Load older messages

**When:** user clicks **Load older messages** (pagination).

Same as a Fetch operation above: one new rskafka client connection, one FetchRequest (up to 10 MB). Each "load more" click is a separate, independent fetch request.

---

### ⬡ Config tab

**When:** user opens the **Config** tab on a topic (loads automatically).

| Call | Kafka API | Direction |
|---|---|---|
| All config entries | DescribeConfigs v0 (API 32) | Read |

- 1 TCP connection.
- Reads all dynamic and static configuration keys for the topic (retention, compaction, etc.).
- **Read-only.**

---

### ⬡ Consumer groups list (left panel)

**When:** a broker is selected and the left panel loads consumer groups; or user clicks Refresh.

| Call | Kafka API | Direction |
|---|---|---|
| All groups | ListGroups v0 (API 16) | Read |
| Group states | DescribeGroups v0 (API 15, all groups in one request) | Read |

- 1 TCP connection, 2 Kafka API calls.
- **Read-only.**

---

### ⬡ Topic → Consumers tab (group scan)

**When:** loads automatically when you open the **Consumers** tab on a topic; or user clicks Refresh.

| Call | Kafka API | Direction |
|---|---|---|
| Latest offsets for the topic | ListOffsetsRequest v0 (all partitions) | Read |
| All groups | ListGroups v0 | Read |
| Committed offsets for this topic | **OffsetFetch v2 (API 9), one call per group** | Read |

> ⚠ **Scan cost scales with the number of groups.** This issues one OffsetFetch per consumer group to find which ones have committed offsets on the topic. To protect large clusters, the scan is **capped at the first 500 groups**.

- 1 TCP connection, 2 + G calls (G = groups scanned, ≤ 500).
- **Read-only.** No consumer group is modified.

---

### ⬡ Consumer group details

**When:** user clicks a consumer group (loads automatically).

| Call | Kafka API | Direction |
|---|---|---|
| Group state + members + partition assignment | DescribeGroups v0 | Read |
| Committed offsets (whole group, one request) | **OffsetFetch v2 (API 9), null topics** | Read |
| Latest offset per committed topic | ListOffsetsRequest v0, **one call per topic** (batched over partitions) | Read |

- 1 TCP connection, 2 + T Kafka API calls (T = number of distinct topics with a committed offset).
- A single OffsetFetch returns all of the group's committed offsets — no all-cluster metadata fetch and no per-partition request. ListOffsets is then batched once per topic.
- The member assignment is decoded to show **which consumer owns each partition**.
- **Read-only.** No consumer group offset is modified.

---

### ✏ Produce tab — Send Message / Send Batch

**When:** user clicks **Send Message** or **Send Batch** in the Produce tab. Never automatic.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client | New TCP connection | — |
| Write message(s) | ProduceRequest (no compression) | **Write** |

> ⚠ **This permanently writes to the topic.** Messages are retained according to the topic's retention policy (time or size). It cannot be undone. Send only intentional test or operational messages.

- 1 TCP connection, 1 ProduceRequest.
- The message is appended at the next available offset in the selected partition (or partition 0 if Auto mode is used).
- A batch is capped at **10,000 records** per send.

---

### ✏ Create Topic

**When:** user fills in the create-topic form and confirms.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client + controller client | New TCP connection | — |
| Create topic | CreateTopicsRequest | **Write** |

> ⚠ **Permanently creates a topic on the cluster.** Partition count and replication factor cannot easily be reduced after creation.

- Inputs are validated client-side first: partitions must be 1–10,000 and replication factor ≥ 1, so an obviously invalid request never reaches the broker.

---

### 🗑 Delete Topic

**When:** user confirms a topic deletion. The UI requires typing the exact topic name **and** solving a small arithmetic check before the delete button enables.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client + controller client | New TCP connection | — |
| Delete topic | DeleteTopicsRequest | **Destructive Write** |

> ⚠ **Irreversible. Permanently deletes the topic and all of its data.** There is no recycle bin. Only delete topics you are certain you want gone.

---

## Summary: what never happens

- No consumer group is ever created or modified by read operations.
- No offsets are committed except by the Produce flow (which is a write).
- No background polling or subscriptions are kept open between user actions — reads fire on navigation or an explicit Refresh, nothing on a timer.
- No message data is cached outside of the app's memory (closes with the window).

## Notes on production use

| Risk level | Operations |
|---|---|
| Safe to run on production | Broker selection, topic list, topic details, Config tab, Consumer groups list, Consumer group details |
| Low risk (read ≤10 MB per call) | Fetch messages, Load more |
| Medium risk on huge clusters | Topic → Consumers tab scan (capped at 500 groups) |
| **Write — irreversible** | Produce message |
| **Destructive — irreversible** | Delete topic |
