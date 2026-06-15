# Kafka Explorer — How It Works

This document describes every interaction Kafka Explorer makes with your Kafka cluster: what protocol calls are issued, when they happen, and their potential impact. Read this before connecting to a production cluster.

---

## Connection model

**There is no persistent connection.** Every operation opens a new TCP connection to your broker and closes it when the operation finishes. Most read-path operations actually open *two* TCP connections per action: one short-lived probe connection (a MetadataRequest is sent to verify the host is a Kafka broker, not a ZooKeeper or other port), then a second fresh connection for the real command.

The `fetch_messages` and `produce` operations use [rskafka](https://github.com/influxdata/rskafka) as the client library, which manages its own connection lifecycle per call.

The client identifies itself to brokers with the client ID **`devtool`**. You will see this in broker logs and JMX metrics.

---

## Operations reference

Each entry below lists: **when it fires**, **what Kafka API calls are made**, and **the impact**.

### ⬡ Broker selection

**When:** user selects a broker in the left panel, or clicks "Test connection."

| Call | Kafka API | Direction |
|---|---|---|
| Probe (confirm this is a Kafka port) | MetadataRequest v0 (API 3) | Read |
| Test connection | MetadataRequest v0 (API 3) | Read |

- 2 TCP connections, 2 MetadataRequests.
- Reads broker list and topic names (payload is small).
- **No data is written. No consumer group is created.**

---

### ⬡ Topic list

**When:** a broker is selected (fires automatically) or the user clicks Refresh.

| Call | Kafka API | Direction |
|---|---|---|
| Probe | MetadataRequest v0 | Read |
| Fetch all topics | MetadataRequest v0 (empty topic filter = all) | Read |

- 2 TCP connections, 2 MetadataRequests.
- Returns all topic names, partition counts, and replication factors.
- **Scales with total number of topics on the cluster.** A cluster with thousands of topics returns a proportionally larger metadata payload.

---

### ⬡ Topic details (opening a topic)

**When:** user clicks a topic in the left panel.

| Call | Kafka API | Direction |
|---|---|---|
| Probe | MetadataRequest v0 | Read |
| Topic partition metadata | MetadataRequest v0 (single topic) | Read |
| Earliest offsets (all partitions) | ListOffsetsRequest v0 (API 2), timestamp=−2 | Read |
| Latest offsets (all partitions) | ListOffsetsRequest v0 (API 2), timestamp=−1 | Read |

- 2 TCP connections, 4 Kafka API calls.
- The two ListOffsets calls each cover all partitions in one request.
- **No data is written. No consumer group is created.**

---

### ⬡ Messages tab — Fetch

**When:** user clicks **Fetch** in the Messages tab.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client | New TCP connection to broker | — |
| (Latest mode only) Resolve tail offset | OffsetFetch (get high-watermark) | Read |
| Fetch records | FetchRequest — up to **10 MB** per call | Read |

- 1 rskafka client connection, 1–2 Kafka API calls.
- **Up to 10 MB of message data is pulled per fetch.** On high-throughput topics with large messages this can be a meaningful read.
- **No consumer group offset is committed.** Kafka Explorer does not create a consumer group, does not register a group ID, and does not advance any consumer position. Your existing consumer groups are not affected.
- **Messages are read-only** — no data is modified or deleted.

---

### ⬡ Messages tab — Load older messages

**When:** user clicks **Load older messages** (pagination).

Same as a Fetch operation above: one new rskafka client connection, one FetchRequest (up to 10 MB). Each "load more" click is a separate, independent fetch request.

---

### ⬡ Config tab

**When:** user opens the **Config** tab on a topic.

| Call | Kafka API | Direction |
|---|---|---|
| Probe | MetadataRequest v0 | Read |
| All config entries | DescribeConfigs v0 (API 32) | Read |

- 2 TCP connections, 2 Kafka API calls.
- Reads all dynamic and static configuration keys for the topic (retention, compaction, etc.).
- **Read-only.**

---

### ⬡ Consumer groups list (left panel)

**When:** a broker is selected and the left panel loads consumer groups; or user clicks Refresh.

| Call | Kafka API | Direction |
|---|---|---|
| Probe | MetadataRequest v0 | Read |
| All groups | ListGroups v0 (API 16) | Read |
| Group states | DescribeGroups v0 (API 15, all groups in one request) | Read |

- 2 TCP connections, 3 Kafka API calls.
- **Read-only.**

---

### ⬡ Consumer group details

**When:** user clicks a consumer group in the left panel.

| Call | Kafka API | Direction |
|---|---|---|
| Probe | MetadataRequest v0 | Read |
| Group state + member count | DescribeGroups v0 | Read |
| All topic metadata (for partition enumeration) | MetadataRequest v0 (all topics) | Read |
| Committed offsets (all topics + partitions at once) | OffsetFetch v1 (API 9) | Read |
| Latest offset for each committed partition | **ListOffsetsRequest v0, one call per partition** | Read |

> ⚠ **Potential performance impact.** The lag calculation requires fetching the latest offset for each individual partition that has a committed offset. A consumer group with committed offsets on 50 partitions across several topics will issue **50 individual ListOffsets requests** in sequence. On large clusters or groups with wide topic coverage this can be slow and generates noticeable broker-side load.

- 2 TCP connections, 3 + N Kafka API calls (N = number of partitions with a committed offset).
- **Read-only.** No consumer group offset is modified.

---

### ✏ Produce tab — Send Message

**When:** user clicks **Send Message** in the Produce tab.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client | New TCP connection | — |
| Write message | ProduceRequest (no compression) | **Write** |

> ⚠ **This permanently writes a message to the topic.** The message is retained according to the topic's retention policy (time or size). It cannot be undone. Send only intentional test or operational messages.

- 1 TCP connection, 1 ProduceRequest.
- The message is appended at the next available offset in the selected partition (or any partition if Auto mode is used).

---

### ✏ Create Topic

**When:** user fills in the create-topic form and confirms.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client + controller client | New TCP connection | — |
| Create topic | CreateTopicsRequest | **Write** |

> ⚠ **Permanently creates a topic on the cluster.** Partition count and replication factor cannot easily be reduced after creation.

---

### 🗑 Delete Topic

**When:** user confirms a topic deletion.

| Call | Kafka API / action | Direction |
|---|---|---|
| Build rskafka client + controller client | New TCP connection | — |
| Delete topic | DeleteTopicsRequest | **Destructive Write** |

> ⚠ **Irreversible. Permanently deletes the topic and all of its data.** There is no recycle bin. Only delete topics you are certain you want gone.

---

## Summary: what never happens

- No consumer group is ever created or modified by read operations.
- No offsets are committed except by the Produce flow (which is a write).
- No background polling or subscriptions are kept open between user actions.
- No message data is cached outside of the app's memory (closes with the window).

## Notes on production use

| Risk level | Operations |
|---|---|
| Safe to run on production | Broker selection, topic list, topic details, Config tab, Consumer groups list |
| Low risk (read ≤10 MB per click) | Fetch messages, Load more |
| Medium risk on large groups | Consumer group details |
| **Write — irreversible** | Produce message |
| **Destructive — irreversible** | Delete topic |
