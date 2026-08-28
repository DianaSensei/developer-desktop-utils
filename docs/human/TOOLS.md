# DevTool — How Each Tool Works

This document describes every tool in the app: what computation it performs, what system resources it accesses, what permissions it requires, what it stores, and what the risk level of each action is. Read this before connecting DevTool to sensitive environments or systems.

---

## Summary table

| Tool | Clipboard write | File read | File write | Network | Stores data |
|------|:-:|:-:|:-:|:-:|:-:|
| Cron Generator | ✓ | — | — | — | Input (localStorage) |
| Text Transformer | ✓ | — | — | — | Input (localStorage) |
| Text Counter | — | — | — | — | Input (localStorage) |
| Color Picker | ✓ | — | — | — | Input (localStorage) |
| Encode · Hash · Encrypt | ✓ | ✓ | — | — | Input (localStorage) |
| Date / Time | ✓ | — | — | — | Input (localStorage) |
| JSON Formatter | ✓ | — | — | — | Input (localStorage) |
| Data Converter | ✓ | — | ✓ | — | Input + options (localStorage) |
| SQL Formatter | ✓ | — | — | — | Input + options (localStorage) |
| JWT Debugger | — | — | — | — | Input (localStorage) |
| Regex Tester | — | — | — | — | Input (localStorage) |
| Diff | — | — | — | — | Input + mode (localStorage) |
| Markdown Preview | — | — | — | — | Input (localStorage) |
| Lucky Wheel | — | — | — | — | Choices + options (localStorage) |
| Array Deduplicator | ✓ | — | — | — | Input (localStorage) |
| Generator | ✓ | — | ✓ | — | Random + Test Data schema/options (localStorage) |
| Time Tracker | ✓ | — | — | — | Time entries, projects, tags (localStorage) |
| QR Code | ✓ (image) | ✓ | ✓ | — | Mode (localStorage) |
| Kafka Explorer | ✓ | — | — | **✓ TCP** | Broker configs (app data); produce draft in-memory |
| RabbitMQ | ✓ | — | — | **✓ HTTP/HTTPS (mgmt API, browse/create) + AMQP 5672/5671 (publish/consume/RPC)** | Connection profiles incl. password & client identity (app data) |
| Redis | ✓ | — | — | **✓ TCP 6379/6380 (RESP protocol)** | Connection profiles incl. password (app data) |
| Network Tools | ✓ | — | — | **✓ HTTPS** + local read | In-memory session, cleared on app restart |
| API Client | ✓ | ✓ (import) | ✓ (export) | **✓ HTTP/HTTPS — any URL you send to** | Collections, environments & history (localStorage) |
| Mock Server | ✓ | — | — | **✓ Local HTTP listener you start (127.0.0.1, or 0.0.0.0 = LAN)** | Stubs + server settings (localStorage); request log in-memory, cleared on restart |
| 2FA Authenticator | ✓ | ✓ (QR image) | — | — | Accounts **including TOTP/HOTP secrets** (localStorage) |

---

## Local-only tools

These tools run entirely in the WebView — no Rust commands, no network, no file system beyond clipboard write. All processing is in-memory JavaScript.

### Cron Generator

Parses and validates cron expressions. Computes the next N scheduled times using a local CRON library (no system clock beyond `new Date()`). Clipboard: writes the expression string when you copy.

**OS / system impact:** none beyond clipboard write.

---

### Text Transformer

Applies text operations (case conversion, sort, trim, reverse, deindent, ROT13, slug, etc.) to the input string. All transformations are pure string functions in JS.

**OS / system impact:** clipboard write only.

---

### Text Counter

Counts characters, words, lines, sentences, and estimates reading time from the input. No output — display only.

**OS / system impact:** none.

---

### Color Picker

Converts a color between HEX, RGB, HSL, HSV, and CMYK. Renders a color swatch in the browser. Clipboard: writes the formatted color string.

**OS / system impact:** clipboard write only.

---

### Encoder / Decoder

Encodes and decodes text in multiple formats: Base64, URL percent-encoding, HTML entities, hexadecimal, and Morse code. All conversions run in JS with no external dependencies.

> The **Encode · Hash · Encrypt** tool bundles seven tabs: Encode/Decode (this section), **Image ↔ Base64**, **Hash & Encrypt**, **Checksum** (file hashing), **Password** (bcrypt/Argon2), Encrypt, and Pipeline. The sections below describe each tab; only the Image and Checksum tabs read files.

**OS / system impact:** clipboard write only.

---

### Hash & Encrypt

Computes **MD5, SHA-1, SHA-256, SHA-512** hashes of typed/pasted text using the `crypto-js` library (JavaScript — not the browser's Web Crypto API). Also encrypts/decrypts text with **AES** using a passphrase.

> Note: this tab hashes **text you type or paste**, not files. For file checksums, use the Checksum tab.

**OS / system impact:** clipboard write only. No data leaves the app.

---

### Date / Time

Converts Unix timestamps to human-readable dates and vice versa. Formats dates in any IANA timezone using `date-fns`. Computes time differences and boundary values (start/end of day, week, month).

**OS / system impact:** clipboard write only. Reads the system clock via `new Date()` (standard for all web apps).

---

### JSON Formatter

Formats, minifies, and validates JSON. Renders an interactive tree explorer. All processing is `JSON.parse` / `JSON.stringify` in JS.

**OS / system impact:** clipboard write only.

---

### Data Converter

Converts structured data between JSON, YAML, TOML, XML, and Java `.properties`. Each conversion parses the source into a plain in-memory value and re-serializes it into the target format — all in JS, with the per-format libraries (`js-yaml`, `smol-toml`, `fast-xml-parser`) bundled and lazy-loaded, and `.properties` parsed in-house, so it runs fully offline. For `.properties`, dotted keys map to nested objects and `key[0]` to array indices. No data leaves the device. "Download result" opens a native save dialog (desktop) or a browser download (web).

**OS / system impact:** clipboard write; file write on download only.

---

### SQL Formatter

Formats and beautifies SQL queries — keyword casing, whitespace collapse, and clause line breaks — entirely in JS. No database connection is ever made; it only reshapes the text you paste.

**OS / system impact:** clipboard write only.

---

### JWT Debugger

Decodes a JWT by splitting on `.` and base64-decoding each part. **No signature verification is performed.** No network call is made — this tool cannot tell you if a token is valid or expired (it only shows the claims).

**OS / system impact:** none. Tokens you paste are never transmitted anywhere.

---

### Regex Tester

Runs the regex you provide against the test input using the browser's built-in `RegExp` engine. Highlights matches inline.

**OS / system impact:** none. Poorly written regexes (catastrophic backtracking) can cause temporary high CPU usage; the UI stays responsive but the match result may be slow.

---

### Diff

Two modes. **Text** compares two blocks word-level and highlights additions/removals using the `diff` npm package. **JSON** parses both sides and computes a structural diff — every difference is listed by key/index path as added, removed, or changed (old → new), ignoring formatting and key order. The JSON diff is a small hand-rolled recursive walk; both modes run entirely in JS.

**OS / system impact:** none.

---

### Markdown Preview

Renders Markdown to HTML using `react-markdown`. Does not execute any embedded scripts. Supports standard CommonMark; no GitHub Flavored Markdown extensions that make external requests.

**OS / system impact:** none.

---

### Lucky Wheel

Spins a wheel built from your own choices (one per line) and picks a random winner. Duplicate lines are kept by default — repeating a value gives it more slices and higher odds — and a "unique values only" toggle collapses duplicates to one slice each. The wheel is drawn on an HTML `<canvas>` with an animated spin and a winning-segment pulse; the landing position uses `Math.random()` over a uniform rotation offset, so every slice has equal odds. Optionally removes the winner from the list after each spin. The spin duration is configurable, and an auto-spin mode draws up to *N − 1* distinct winners in a row (where *N* is the number of slices) without altering the list. Every spin is recorded in a winner history table (choice + time) that can be sorted by spin time (newest first by default).

**OS / system impact:** none. Choices, the "remove winner" preference, and the spin history persist in `localStorage`; nothing is sent anywhere.

---

### Array Deduplicator

Removes duplicate lines from a list. Supports case-insensitive matching and sorting. Pure string processing in JS.

**OS / system impact:** clipboard write only.

---

### Generator

Two tabs behind one tool: **Random** and **Test Data**.

**Random** generates quick values in three modes:

| Mode | Algorithm | Notes |
|------|-----------|-------|
| UUID v4 | `uuid` library → `crypto.getRandomValues` | Cryptographically random |
| Random text | Custom charset + `crypto.getRandomValues` | Cryptographically random |
| Random number | `Math.random()` | Not cryptographically random |

**Test Data** generates realistic fake records from a field schema you define. 40+ field types grouped by Identity (name, job title…), Internet (email, username, URL, IP, MAC…), Location (address, city, country, lat/long…), Business, Finance (IBAN, currency, credit card…), Content (lorem), and primitives (int/float/boolean/date/enum). Choose a row count and export as a JSON array, NDJSON, YAML, CSV, TSV, SQL `INSERT` statements (with a table name), or Java `.properties`. Generation uses the **`@faker-js/faker`** library, which is bundled and **lazy-loaded** (fetched only when the tool opens) so it works fully offline; `faker.seed()` makes output deterministic for a given seed. Useful for seeding databases or feeding the Mock Server / API Client.

**OS / system impact:** clipboard write; file write on Test Data download only. Uses the browser's `crypto.getRandomValues` — no external RNG service, no network.

---

### Password Hash

*(The Password tab of Encode · Hash · Encrypt.)* Hashes and verifies passwords with **bcrypt** and **Argon2** (id / i / d), backed by the `hash-wasm` library whose WebAssembly is bundled inline (no fetch), so it runs fully offline. Hashing uses a fresh random 16-byte salt (`crypto.getRandomValues`) and outputs the standard encoded string (bcrypt modular-crypt `$2b$…` or Argon2 PHC `$argon2id$…`). Verify auto-detects the algorithm from the hash prefix. Work factors (bcrypt cost; Argon2 memory/iterations/parallelism) are adjustable; hashing runs on an explicit button, not as you type.

**OS / system impact:** clipboard write only. The password is processed in memory and **never stored** — only non-secret parameters (algorithm, cost) persist in `localStorage`. Nothing leaves the machine.

---

### Time Tracker

A time-management suite with four views: time tracker, timesheet, calendar, and meeting notes. All entries, projects, and tags are computed and stored **locally in `localStorage`** — there is no account, sync, or server. Closing and reopening the app preserves your data; clearing browser storage erases it.

The **Meeting Notes** view manages meeting minutes: create, search, edit, and delete notes from a sidebar list. Each note has a title, date, start/end time (with derived duration), participants, agenda/discussion, decisions, and action items, assembled into clean Markdown in real time (action items become task checkboxes); the preview renders with `react-markdown` and copy writes the Markdown to your clipboard. Notes live in a shared `devtool:meetings` record, so a meeting with a time range also shows on the **Calendar** — edits sync both ways. Markdown is generated one-way from the form (no markdown-to-form editing).

**OS / system impact:** clipboard write only. No network, no file access — everything persists in `localStorage` (`devtool:meetings` for notes).

---

## Tools with file system access

### Checksum

*(The Checksum tab of Encode · Hash · Encrypt.)* Computes MD5, SHA-1, SHA-256, or SHA-512 checksums of a file you select. Supports files of any size via chunked reading with a live progress bar.

#### How it works by environment

**Desktop (Tauri):**
1. You click "Browse" → opens a native file picker (`dialog:allow-open`). Only the path of the selected file is returned.
2. The path is sent via Tauri IPC to the Rust `hash_file` command.
3. Rust reads the file in chunks (streaming), emitting `checksum:progress` events back to the UI.
4. The file **never passes through the WebView memory** — Rust hashes it directly and returns only the hex digest.
5. You can also drag a file onto the window; Tauri's `onDragDropEvent` captures the file path and triggers the same Rust command.

**Web (browser):**
1. You select a file via `<input type="file">`.
2. The `File` object is sent to a Web Worker (`src/workers/checksum.worker.ts`).
3. The worker reads it in chunks with `FileReader` and hashes with `crypto-js`.
4. Progress events are posted back to the main thread.

**Permissions (Tauri):** `dialog:allow-open`, `core:default` (for IPC events and invoke).  
**OS / system impact:** reads one file at a time, only at the path you explicitly chose. No file is written. No data leaves the machine.

---

### Image ↔ Base64

*(The Image tab of Encode · Hash · Encrypt.)* Converts images to and from base64 data URLs. You can also preview a pasted base64 string as an image.

#### How it works

- **Encode (image → base64):** Uses a browser `<input type="file">` or drag-and-drop. The `FileReader` API reads the file into memory and base64-encodes it in JS. No Tauri file dialog — the file access goes through the browser's standard file input.
- **Decode (base64 → image):** Parses the pasted base64 string and renders it as an `<img>` element. Auto-detects PNG, JPEG, GIF, WebP by inspecting the first bytes of the decoded data.

**Permissions (Tauri):** none beyond standard WebView file input.  
**OS / system impact:** reads one image file at a time via browser file input. Image data stays in memory; nothing is written to disk. Clipboard write for the base64 output.

---

### QR Code

Generates QR codes from text/URLs and decodes QR codes from image files.

#### Generate

- Renders the QR code onto an HTML `<canvas>` element using the `qrcode` library.
- **Download as PNG (Tauri):** opens a native save dialog (`dialog:allow-save`), converts the canvas to a PNG byte array, then writes it to the chosen path with `fs:allow-write-file`.
- **Download as PNG (web):** creates a temporary `<a download>` element — triggers the browser's own download.
- **Copy to clipboard:** uses the browser Clipboard API (`navigator.clipboard.write`) to write an `image/png` blob. This requires browser clipboard permission (not a Tauri capability).

#### Decode

- **Tauri:** opens a native file picker (`dialog:allow-open`), reads the image file with `fs:allow-read-file`, passes raw bytes to the JS decoder (running in the WebView).
- **Web:** uses `<input type="file">` to read the image, then passes it to the JS decoder.

**Permissions (Tauri):** `dialog:allow-open`, `dialog:allow-save`, `fs:allow-read-file`, `fs:allow-write-file`, `fs:scope-appdata-recursive`.  
**OS / system impact:** reads the image file you select; writes a PNG only to the path you explicitly choose. No data leaves the machine.

---

## Tools with network access

### Kafka Explorer

Opens TCP connections to Kafka brokers you configure. You must **Connect** a broker before any views are accessible — there is no auto-connect on launch. Reads load when you open a view (topic messages, consumers, group details) and refresh on navigation or explicit Refresh — there is **no background polling**. Writes (produce/create/delete) are always explicit. Connections are **plaintext only**: TLS/SSL and SASL authentication are not implemented, so don't point it at a broker requiring encryption or credentials.

See **[kafka-explorer.md](kafka-explorer.md)** for the full operation-by-operation breakdown including which Kafka API calls are made, their direction, and their impact.

**Produce form** persists across tool and tab switches until the app closes (in-memory only — nothing written to disk). The produce value field supports JSON syntax highlighting and a Format (pretty-print) button. Topic and key inputs record per-broker history for quick re-use.

**Live consume** streams messages directly to the UI via a Tauri channel; message bodies support JSON and plain-text highlighting. Consumers keep running while you navigate within the tool and stop when you leave or click Stop.

#### Broker config storage

Broker connection details (host, port, TLS settings, label) are saved to:

```
macOS:    ~/Library/Application Support/devtool/kafka-brokers.json
Windows:  %APPDATA%\devtool\kafka-brokers.json
Linux:    ~/.local/share/devtool/kafka-brokers.json
```

This file is written by Rust (`fs::write`) whenever you save or delete a broker config. It is **not** encrypted — do not store credentials you would not want readable by other processes on the same machine. The file is local-only; it is never transmitted.

#### Risk levels at a glance

| Action | Risk |
|--------|------|
| Browse topics, partitions, consumer groups | Read-only — safe on production |
| Fetch messages | Reads up to 10 MB per click — low risk |
| Consumer group details (large groups) | Many sequential ListOffsets requests — medium broker load |
| Produce message | **Permanent write** — cannot be undone |
| Create topic | **Permanent** — partition count cannot be reduced after creation |
| Delete topic | **Irreversible** — all data is gone |

### RabbitMQ

You must **Connect** a connection profile before any views are accessible — there is no auto-connect on launch. Talks to the RabbitMQ **Management plugin** HTTP REST API (default port `15672`) at the host you configure for everything except Publish, Consume and Request/Response. Each request sends your username and password as HTTP Basic auth to that host; use TLS (HTTPS) for any non-local broker. Reads (overview, queues, exchanges, bindings, connections) load when you open a view and refresh on navigation or an explicit Refresh — there is **no background polling**. Writes are always explicit and **non-destructive by design**: Publish sends a real message and Create exchange/queue/binding apply via the management API, but the tool exposes **no purge or delete** of queues/exchanges.

**Multiple hosts (HA failover):** a connection profile can list multiple broker addresses (e.g. `10.0.0.1:5672, 10.0.0.2:5672`). The tool tries each within a 15-second timeout and uses the first that responds.

**Publish, Consume and Request/Response** use **AMQP** rather than the management API (these are real broker operations the HTTP API can't do faithfully). They connect to the configured host on the **AMQP port** (default `5672`, or `5671` when TLS is on):

- **Publish** — a real `basic.publish` with full message properties, optional **mandatory** flag (unroutable messages are returned, not silently dropped) and **publisher confirms** (so the tool can report confirmed/routed). The request payload and reply support JSON syntax highlighting.
- **Consume** — `basic.consume` with a bounded **prefetch**, managed centrally in the **Consumers** panel and **confirmed before it starts**. *Peek* is non-destructive — messages are delivered unacked and requeued (flagged `redelivered`) when you stop — but it is still a real subscription, so on a queue with other consumers it competes for and temporarily withholds the messages it holds. *Consume* acknowledges and **permanently removes** each message it receives. *Respond* makes the tool an **RPC server** — it acks (removes) each request and publishes a reply (echo or a fixed payload) to the request's `reply_to` with the same correlation id. Because RabbitMQ delivers each message to only one consumer, **any** mode takes a share of messages from existing consumers on the same queue; the panel warns you when the target queue already has consumers. Consumers keep running while you navigate within the tool and stop on Stop or when you leave the tool — there is no unbounded buffering.
- **Request/Response** — direct reply-to (`amq.rabbitmq.reply-to`) over a one-shot connection. Exchange, routing-key, and queue fields remember per-connection history for quick re-use.

**AMQP-only mode** — for brokers that expose no management HTTP API, enable *AMQP-only* on the connection. The tool then talks to the broker exclusively over AMQP: AMQP can't *enumerate* queues/exchanges, so you **track them by name** (the names are remembered per connection in `localStorage`), and the tool uses a **passive declare** to report whether a named queue/exchange exists plus its live ready/consumer counts. Create queue/exchange and bind run over AMQP (`queue_declare` / `exchange_declare` / `queue_bind`); publish/consume/RPC are unchanged. **Overview, Connections and the browse-all lists are unavailable** in this mode because there is no way to enumerate them over AMQP. The management port is ignored, and **Test** opens an AMQP connection instead of an HTTP request.

TLS supports trusting a **custom CA certificate (PEM)** for self-signed/private brokers and **mutual TLS** via a **PKCS#12 client identity** (base64). Heartbeat interval and a client connection name can be set (the name shows in the broker's Connections list).

#### Connection profile storage

Connection profiles (name, host(s), management port, AMQP port, vhost, username, **password**, TLS flag, optional **CA cert** + **PKCS#12 client identity & password**, heartbeat, connection name, extra hosts for HA failover) are saved to:

```
macOS:    ~/Library/Application Support/devtool/rabbit-connections.json
Windows:  %APPDATA%\devtool\rabbit-connections.json
Linux:    ~/.local/share/devtool/rabbit-connections.json
```

Written by Rust (`fs::write`) whenever you save or delete a connection. It is **not** encrypted and **includes the password** — do not store credentials you would not want readable by other processes on the same machine. The file is local-only; it is never transmitted anywhere except as Basic auth to the management host you configured.

#### Risk levels at a glance

| Action | Risk |
|--------|------|
| Browse overview, queues, exchanges, bindings, connections | Read-only (management API) — safe on production |
| Create exchange / queue / binding | **Permanent write** via the management API — the tool offers no delete to undo it |
| Publish message | **Permanent write** — a real `basic.publish`; routed/persistent messages are stored by the broker and cannot be unsent |
| Consume — Peek | Non-destructive (nothing acked), but a real subscription: on a queue with other consumers it competes for and temporarily withholds up to *prefetch* messages, requeued as `redelivered` on stop |
| Consume — Consume (ack) | **Permanent** — acknowledges and removes the messages it receives |
| Respond (RPC server) | **Permanent** — acks (removes) each request and publishes a reply to its `reply_to` |
| Purge / delete queue or exchange | **Not available** — the tool never purges or deletes |

**Permissions (Tauri):** `core:default` (for Tauri IPC), outbound TCP via Rust (no Tauri capability needed — Rust has unrestricted network access).

---

### Redis

You must **Connect** a connection profile before any views are accessible — there is no auto-connect on launch. Every command (Overview, Keys, CLI Console) opens its own short-lived TCP connection to the configured host over the Redis **RESP protocol** (default port `6379`, or `6380` when TLS is on) — there is **no persistent connection pool and no background polling**; a view only talks to the server when you open it, refresh it, or run a command.

**Key Browser** always paginates with `SCAN`/`HSCAN`/`SSCAN`/`ZSCAN` (never `KEYS` or an unbounded `HGETALL`/`SMEMBERS`), so browsing a large keyspace or a large collection can't block the server. A single collection key is read up to **2,000 elements** per fetch; larger collections show a **truncated** notice.

**Key editors** are type-aware (String, Hash, List, Set, Sorted Set) — field/member add, remove, and TTL edits run as targeted commands (`HSET`/`HDEL`/`SADD`/`SREM`/`ZADD`/`ZREM`/`LPUSH`/`RPUSH`/`LREM`/`EXPIRE`/`PERSIST`), each a **real, immediate write** with no undo. List item removal uses `LREM key 1 <value>`, which removes the first matching value — not safe with duplicate values in the list. Stream and other unsupported types are shown read-only with a pointer to the CLI Console.

**CLI Console** runs **any** command you type, including destructive ones (`DEL`, `FLUSHDB`, `FLUSHALL`) — there is no allow-list. Commands run against the database selected in the left panel's DB switcher; a typed `SELECT n` does not persist across commands (each command opens a fresh connection and re-selects the configured db) — use the switcher instead.

TLS uses the OS trust store (`rediss://`, no custom CA / mutual TLS support yet).

#### Connection profile storage

Connection profiles (name, host, port, username, **password**, TLS flag) are saved to:

```
macOS:    ~/Library/Application Support/devtool/redis-connections.json
Windows:  %APPDATA%\devtool\redis-connections.json
Linux:    ~/.local/share/devtool/redis-connections.json
```

Written by Rust (`fs::write`) whenever you save or delete a connection. It is **not** encrypted and **includes the password** — do not store credentials you would not want readable by other processes on the same machine. The file is local-only; it is never transmitted anywhere except to the Redis server you configured.

#### Risk levels at a glance

| Action | Risk |
|--------|------|
| Overview, browse keys | Read-only — safe on production |
| View a key's value | Read-only, capped at 2,000 elements per collection |
| Edit a field/member, set TTL, rename | **Permanent write** — no undo |
| Delete a key | **Permanent** — no undo |
| CLI Console | **Anything** — no allow-list; includes `DEL`, `FLUSHDB`, `FLUSHALL` |

**Permissions (Tauri):** `core:default` (for Tauri IPC), outbound TCP via Rust (no Tauri capability needed — Rust has unrestricted network access).

---

### Network Tools

A suite of DNS and IP utilities. Every lookup is user-initiated (you type a domain/IP and click a button or press Enter) — there is no background polling or auto-query, except the **Local Network** and **Ports** tabs, which read your own machine locally when first opened.

| Sub-tool | What is sent | Service contacted |
|----------|--------------|-------------------|
| DNS Lookup (A, AAAA, CNAME, MX, NS, TXT, SOA, SRV, CAA, PTR, ALL) | The domain name you enter | DNS-over-HTTPS: Cloudflare, Google, Quad9, or AdGuard (your pick) |
| Propagation | The domain name you enter | All four DoH resolvers above, in parallel |
| DNSSEC | The domain name you enter | Selected DoH resolver (DS / DNSKEY / RRSIG + AD flag) |
| What's My IP | Nothing (the request itself reveals your IP) | `ipapi.co`, falling back to `ipwho.is` / `freeipapi.com` |
| IP Lookup | The IP address you enter | `ipapi.co`, falling back to `ipwho.is` / `freeipapi.com` (geolocation, ISP, ASN) |
| Local Network | **Nothing — read locally** | None. Reads hostname, LAN addresses, and interfaces via the Rust `local_network_info` command. Desktop app only. |
| Ports | **Nothing — read locally** | None. Lists the machine's listening sockets grouped by owning process via the Rust `list_listening_ports` command (`netstat2` for the socket table on macOS/Linux/Windows, `sysinfo` for process info). Each process row shows its port(s), name, PID, resident memory, uptime, working-directory/project name, detected framework, and command line. Framework detection is heuristic — from the command line, the executable name, and (for Node projects) the dependencies in the project's `package.json`, which is read locally and never sent anywhere. CPU% is intentionally omitted so a scan stays instant. Desktop app only. Sockets owned by your own user resolve fully; processes owned by other users or the system may require running the app with elevated privileges to appear (an OS restriction, not a limitation of the tool). |

The **Ports** tab has two layouts (toggle in the toolbar): **Processes** (grouped — one row per process, with its ports as chips) and **Sockets** (one row per listening socket — the raw list). Both are filterable (by port, process, framework, project, or PID) and sortable by column; each port shows a reachability **Scope** (`local` loopback-only · `LAN` a specific interface · `all` every interface) and can be ⭐ **favourited** to track in a watchlist (favourites persist across restarts in `localStorage` under `devtool:network:favoritePorts`; a favourite that isn't currently bound shows as **FREE** so you can see if a port is free).

**What leaves the machine:** only the domain name or IP you explicitly look up over HTTPS. The Local Network and Ports tabs are entirely local. No telemetry. Inputs, selections, and results are held in an **in-memory session store** (not `localStorage`) so they survive switching tabs and leaving/returning to the tool, but are cleared on a fresh app launch — none of it leaves the machine (favourite ports are the one persisted exception).

**Accuracy note:** IP geolocation is approximate and provided by a third party; DoH answers reflect the chosen resolver's cache and may differ from your system resolver.

**Permissions (Tauri):** `http:default`, scoped in `capabilities/default.json` to exactly the seven hosts above (Cloudflare/Google/Quad9/AdGuard DNS + ipapi.co/ipwho.is/freeipapi.com) — no other URLs are reachable. In the desktop app, HTTP requests are made from Rust via the HTTP plugin (so they aren't blocked by browser CORS/Origin rules); the web build uses the WebView's `fetch` (where some IP services may be unreachable due to CORS). Local network info uses the `local_network_info` Rust command (reads interfaces only, no file access), and the Ports tab uses the `list_listening_ports` Rust command (reads the OS socket table + process list locally, no file or network access).

### API Client

A Postman/Bruno-style HTTP request workbench: organize requests into collections and folders, set query params, headers, body (JSON, raw, form-data, x-www-form-urlencoded), and auth (Bearer/Basic), then send and inspect the status, timing, size, headers, and pretty-printed body.

**What leaves the machine:** exactly the HTTP request you build and click **Send** on — to whatever URL you type. Nothing is sent in the background; there is no polling and no telemetry. Variables in the active environment (`{{var}}`) are substituted into the outgoing request locally before it is sent.

**Storage:** collections (which can carry shared **Collection Variables** in addition to per-request settings), environments (including any tokens/passwords you store as variables or auth values), the Vault, and the last 50 sends of history persist locally under `devtool:apiclient:*`. This is local to your machine and not encrypted — treat it like any local config file. Any environment variable can be marked **secret** (the lock icon next to it): its value is masked in the editor, left out of generated code snippets and the {{ }} hover tooltip, and — like the Vault — scrubbed from a history entry's response if a server happens to echo it back. Marking a value secret does not encrypt it at rest; it only keeps it out of places it doesn't need to be shown.

**Scripting (Bruno-style):** each request can have a pre-request script, a post-response script, a test script, and declarative assertions. Collections and folders can also carry pre/post scripts that are **inherited** by every request inside them (edit via the collection ⋮ menu → Scripts, or a folder's `</>` action) — pre-request runs collection → folder → request, post-response unwinds in reverse. Scripts are JavaScript with a curated API in scope:

- `bru` — get/set Collection Variables & environment variables (`getCollectionVar`/`setCollectionVar`, `getEnvVar`/`setEnvVar(name, value, 'collection' | 'global')`)
- `req` — read/modify the outgoing request (`getUrl`/`setUrl`, `setHeader`, `setBody`, …)
- `res` — read the response (`getStatus`, `getBody`, `getHeader`, `responseTime`, …)
- `expect` / `test` / `assert` / `console`
- `require(...)` — a small set of bundled libraries: `lodash`, `crypto-js`, `uuid`, `jwt-decode`, `dayjs`
- `pm` — a Postman compatibility shim (`pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.response`, `pm.test`, `pm.expect`, …) so many imported Postman scripts run without rewriting

**Scripts execute in a sandboxed Web Worker**, off the main thread. The worker has the `bru`/`req`/`res`/`pm` API and the bundled `require` libraries, and **nothing else**: no DOM, no `localStorage`, and no Tauri IPC — so a script cannot reach the file system, the clipboard, or the shell. A script that never returns is killed once it passes the **script timeout** (Settings → Configuration → API Client, default 5 s), so a runaway loop cannot freeze the app. Scripts never run on their own — only as part of a Send you initiate. `console.log` output and test results appear in the response panel. Every variable a script sets (`bru.setCollectionVar`/`setEnvVar`) persists — to Collection Variables or to the active environment — in `localStorage`.

> **What a script can still do:** read every variable in scope — including tokens you keep in an environment — and make its own network calls. That is unavoidable for a scripting feature that has to authenticate requests, so treat a script the way you would treat any code you run: know where it came from. As a heads-up (not a guardrail), any script editor shows a warning banner the moment its text calls `fetch`/`XMLHttpRequest`/`WebSocket` directly — whether you just imported it or typed it yourself.

**History:** every send you make by hand is recorded (the last 50) and kept with its full request snapshot and response, so an entry stays inspectable and replayable after the fact. The list is grouped by day, searchable by URL / method / status, and filterable to **All / OK / Failed**. Selecting one shows the request (general, query, path params, headers, body, and which auth scheme was attached — never the credential itself) and the response as two switchable views, so a long header set can never push the response out of the pane. Any entry can be reopened as a new request in the active collection.

**Postman compatibility:** import reads Postman Collection **v2.1** JSON (folders, requests, headers, query, body, bearer/basic auth, and pre-request/test scripts); export writes the same format. Postman scripts use the `pm.*` API — the script text is preserved on import so you can adapt it to Bruno's `bru`/`req`/`res` API. Import/export use the native file picker (desktop) or browser file input/download (web).

**OpenAPI / Swagger import:** the same **Import collection / OpenAPI** action also reads an **OpenAPI 3.x** or **Swagger 2.0** description, in **JSON or YAML** — the format is detected from the file's contents, not its extension. Each operation becomes a request: `info.title` names the collection, `servers[0]` (or Swagger 2's schemes + host + basePath) becomes a `{{baseUrl}}` collection variable that prefixes every URL, operations are grouped into folders by their first **tag**, and `{petId}` path placeholders are rewritten to the `:petId` syntax the client resolves. Parameters come across as query params (required ones enabled, optional ones present but switched off), path params, and headers, each pre-filled with a value from the schema's `example`/`default`/`enum` or a placeholder of the right type. Request bodies are built from the spec's own `example`/`examples` when it has one, otherwise synthesized from the schema (`$ref`s resolved, `allOf` merged, self-referencing schemas terminated) into a JSON, urlencoded, multipart, XML or text body. Security schemes become auth on the collection — bearer, basic, digest, API key, and the OAuth2 client-credentials/password flows — with the secrets left as `{{bearerToken}}`, `{{apiKey}}`, `{{clientId}}` … collection variables for you to fill in; an operation that declares its own `security` overrides that, and `security: []` sends unauthenticated. **`$ref`s are resolved only inside the file you picked** — a pointer to another file or a URL is not followed, so an import never reads other files or makes a network call. Anything with no equivalent here (a TRACE operation, an OpenID Connect scheme, an unsupported body type) is skipped and listed in a banner above the tree rather than dropped silently.

**Importing a collection that carries scripts** is a decision to run someone else's code the next time you press Send, so the import stops and shows you what it found: every script in the file, where it sits in the tree, and its full source. You then choose **Import without scripts** (the default — you keep the requests, folders, headers and auth, and the executable parts are dropped) or **Import with scripts**. A collection with no scripts imports directly, as before.

**Permissions (Tauri):** `http:default` is widened in `capabilities/default.json` to allow `http://**` and `https://**` so the client can reach any API — the same access Postman/Bruno need. Requests still only fire on **Send**. In the desktop app requests are made from Rust via the HTTP plugin (no browser CORS/Origin restriction); the web build uses the WebView's `fetch` (subject to the target's CORS policy). Import/export use the `dialog` + `fs` plugins (user-triggered pickers only).

### Mock Server

A local HTTP mock server for stubbing an upstream API while you build or test a client (it is the *server* counterpart to the API Client's *caller*). You define **stubs** — each a method + path pattern plus optional matchers — and the first stub that matches an incoming request produces the response. Path patterns support `:param` captures (e.g. `/users/:id`) and `*` wildcards. Matchers can require a **query** param, **header**, **path** param, or **body** to `equals` / `contains` / match a `regex` / `exists`. A body matcher has a scope selector: **Whole body** (match the raw body string) or **JSON field** (match a path like `user.name` or `items.0.id` read from the request body as JSON).

The three panels (stubs · editor · request log) are resizable by dragging the dividers, and the request log can be hidden. Stubs can be **reordered** (matching is first-match-wins), **duplicated**, and the whole config can be **copied/imported as JSON** for backup or sharing. The **no-match (fallback) response** — status, content-type, and body returned when nothing matches — is editable from the pinned entry at the bottom of the stub list. Each request-log entry links to the stub it matched.

**Responses** are either:
- **Static** — a status, headers, and a body whose type is **Text**, **JSON**, or **File**. Text/JSON bodies support `{{ token }}` interpolation: `{{request.method}}`, `{{request.path}}`, `{{request.query.NAME}}`, `{{request.header.NAME}}`, `{{request.body}}`, `{{path.NAME}}`, `{{uuid}}`, `{{now}}` (epoch ms), `{{now.iso}}`, `{{randomInt(a,b)}}`. A **File** body is base64 bytes (pick a file or paste base64) served as a binary download — set a download name to add `Content-Disposition: attachment` and the MIME type via the `Content-Type` header.
- **Script** — a sandboxed **Rhai** script that receives `req` (`method`, `path`, `query`, `headers`, `params`, `body`) and returns either a string (a 200 body) or a map `#{ status, headers, body }`. An optional per-stub delay simulates latency.

**What leaves the machine:** nothing outbound. The tool **opens a local TCP listener** on a port you choose so other processes can reach it. By default it binds **local** — both IPv4 `127.0.0.1` and IPv6 `::1` (this machine only), so `http://localhost:<port>` works from any client (browsers, curl, and the Rust-based API Client, which often resolves `localhost` to `::1`). You may switch to `0.0.0.0` to expose it to your local network for device testing — the UI shows a warning while bound this way, and your OS may prompt for firewall access. The server only runs while you click **Start**, and stops on **Stop**.

**Scripting safety:** Rhai is a pure-Rust embedded language with **no filesystem, network, or system access**, and the engine is configured with operation/size/recursion limits so a stub script cannot hang the app or exhaust memory. Scripts are your own and run only when a matching request arrives (or when you click **Test script** in the editor).

**Storage:** stubs and server settings (host/port, default-response) persist in `localStorage` under `devtool:mockServer:config`. The live request log is kept in memory only (capped) and is cleared when the app restarts.

**Permissions (Tauri):** none beyond the default — binding a listener is owned by the app's Rust process and needs no capability grant. Clipboard write is used only for the "copy base URL" button.

---

### 2FA Authenticator

A TOTP / HOTP one-time-password generator — the same codes a phone authenticator app produces. Add an account by entering a Base32 **secret** (with options) or by **importing**, then the tool shows the live code with a countdown ring (TOTP) or a "next code" button (HOTP).

**Algorithms & options:** TOTP and HOTP, hash **SHA-1 / SHA-256 / SHA-512**, **6 or 8** digits, and **30 or 60 second** periods. Codes are computed locally with the WebView's built-in Web Crypto (`crypto.subtle` HMAC) — no library round-trip and nothing leaves the machine.

**Import:** paste `otpauth://totp/...` / `otpauth://hotp/...` URIs, paste a Google Authenticator export string (`otpauth-migration://offline?data=...`), or **import a QR image** (a screenshot/photo of either) — decoded locally with `jsQR`. Each account can also be shown as its own `otpauth://` URI/QR to move it elsewhere.

**What leaves the machine:** nothing. There is no network access at all — code generation, secret decoding, and QR decoding are entirely local.

**Storage — sensitive:** accounts (label, issuer, and the **OTP secret itself**) persist in `localStorage` under `devtool:2fa:accounts`. The secret *is* the second factor, so treat this like any unencrypted local credential store: it's readable by anything running as your user, and the tool surfaces this in its UI. Remove accounts you no longer need.

**Permissions (Tauri):** none beyond the default. Clipboard write copies the current code; QR import uses a file picker (`dialog`/`fs`) only when you choose an image.

---

## What never happens in any tool

- **No telemetry, analytics, or crash reporting.** The only outbound network activity is: Kafka connections you initiate, RabbitMQ management API calls and Request/Response AMQP connections you initiate, DNS/IP lookups you initiate in Network Tools, HTTP requests you send from the API Client, and the app update check described below.
- **Daily auto-update check, on by default.** The auto-update check (Settings → About → Auto-check for updates) is **enabled by default** and contacts the GitHub Releases API at most once per day (plus whenever you click "Check"). It downloads or installs nothing without your action, and you can turn it off in Settings.
- **No input data is sent to any server, except where a tool's whole purpose is a network query.** Computation — hashing, encoding, diffing, JWT decoding, regex matching, 2FA code generation — runs locally in the WebView or in Rust and never leaves the machine. The exceptions are explicit, user-initiated network tools: Kafka Explorer (broker traffic), RabbitMQ (management API calls to the host you configure), Network Tools (the single domain/IP you look up), and the API Client (the exact request you click Send on). The Mock Server only *receives* requests on a local listener you start; it makes no outbound calls.
- **No background file access.** No tool reads files except when you explicitly click "Browse", drag a file, or use a file input.

---

*Last updated: 2026-08-14*
