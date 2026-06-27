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
| Text Diff | — | — | — | — | Input (localStorage) |
| Markdown Preview | — | — | — | — | Input (localStorage) |
| Lucky Wheel | — | — | — | — | Choices + options (localStorage) |
| Array Deduplicator | ✓ | — | — | — | Input (localStorage) |
| Generator | ✓ | — | — | — | Mode pref (localStorage) |
| Time Tracker | ✓ | — | — | — | Time entries, projects, tags (localStorage) |
| QR Code | ✓ (image) | ✓ | ✓ | — | Mode (localStorage) |
| Kafka Explorer | ✓ | — | — | **✓ TCP** | Broker configs (app data) |
| Network Tools | ✓ | — | — | **✓ HTTPS** + local read | In-memory session, cleared on app restart |
| API Client | ✓ | ✓ (import) | ✓ (export) | **✓ HTTP/HTTPS — any URL you send to** | Collections, environments & history (localStorage) |
| Mock Server | ✓ | — | — | **✓ Local HTTP listener you start (127.0.0.1, or 0.0.0.0 = LAN)** | Stubs + server settings (localStorage); request log in-memory, cleared on restart |

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

> The **Encode · Hash · Encrypt** tool bundles six tabs: Encode/Decode (this section), **Image ↔ Base64**, **Hash & Encrypt**, **Checksum** (file hashing), Encrypt, and Pipeline. The sections below describe each tab; only the Image and Checksum tabs read files.

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

### Text Diff

Compares two text blocks and highlights line/character-level additions and removals using the `diff` npm package.

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

Generates random values in three modes:

| Mode | Algorithm | Notes |
|------|-----------|-------|
| UUID v4 | `uuid` library → `crypto.getRandomValues` | Cryptographically random |
| Random text | Custom charset + `crypto.getRandomValues` | Cryptographically random |
| Random number | `Math.random()` | Not cryptographically random |

**OS / system impact:** clipboard write only. Uses the browser's `crypto.getRandomValues` (built into every modern browser/WebView) — no external RNG service.

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

Opens TCP connections to Kafka brokers you configure. Reads load automatically when you open a view (topic messages, consumers, group details) and refresh on navigation or an explicit Refresh — there is **no background polling**, no auto-connect on launch, and writes (produce/create/delete) are always explicit. Connections are **plaintext only**: TLS/SSL and SASL authentication are not implemented, so don't point it at a broker requiring encryption or credentials.

See **[kafka-explorer.md](kafka-explorer.md)** for the full operation-by-operation breakdown including which Kafka API calls are made, their direction, and their impact.

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

**Permissions (Tauri):** `core:default` (for Tauri IPC), outbound TCP via Rust (no Tauri capability needed — Rust has unrestricted network access).

---

### Network Tools

A suite of DNS and IP utilities. Every lookup is user-initiated (you type a domain/IP and click a button or press Enter) — there is no background polling or auto-query, except the **Local Network** tab, which reads your own machine's interfaces locally when first opened.

| Sub-tool | What is sent | Service contacted |
|----------|--------------|-------------------|
| DNS Lookup (A, AAAA, CNAME, MX, NS, TXT, SOA, SRV, CAA, PTR, ALL) | The domain name you enter | DNS-over-HTTPS: Cloudflare, Google, Quad9, or AdGuard (your pick) |
| Propagation | The domain name you enter | All four DoH resolvers above, in parallel |
| DNSSEC | The domain name you enter | Selected DoH resolver (DS / DNSKEY / RRSIG + AD flag) |
| What's My IP | Nothing (the request itself reveals your IP) | `ipapi.co`, falling back to `ipwho.is` / `freeipapi.com` |
| IP Lookup | The IP address you enter | `ipapi.co`, falling back to `ipwho.is` / `freeipapi.com` (geolocation, ISP, ASN) |
| Local Network | **Nothing — read locally** | None. Reads hostname, LAN addresses, and interfaces via the Rust `local_network_info` command. Desktop app only. |

**What leaves the machine:** only the domain name or IP you explicitly look up over HTTPS. The Local Network tab is entirely local. No telemetry. Inputs, selections, and results are held in an **in-memory session store** (not `localStorage`) so they survive switching tabs and leaving/returning to the tool, but are cleared on a fresh app launch — none of it leaves the machine.

**Accuracy note:** IP geolocation is approximate and provided by a third party; DoH answers reflect the chosen resolver's cache and may differ from your system resolver.

**Permissions (Tauri):** `http:default`, scoped in `capabilities/default.json` to exactly the seven hosts above (Cloudflare/Google/Quad9/AdGuard DNS + ipapi.co/ipwho.is/freeipapi.com) — no other URLs are reachable. In the desktop app, HTTP requests are made from Rust via the HTTP plugin (so they aren't blocked by browser CORS/Origin rules); the web build uses the WebView's `fetch` (where some IP services may be unreachable due to CORS). Local network info uses the `local_network_info` Rust command (reads interfaces only, no file access).

### API Client

A Postman/Bruno-style HTTP request workbench: organize requests into collections and folders, set query params, headers, body (JSON, raw, form-data, x-www-form-urlencoded), and auth (Bearer/Basic), then send and inspect the status, timing, size, headers, and pretty-printed body.

**What leaves the machine:** exactly the HTTP request you build and click **Send** on — to whatever URL you type. Nothing is sent in the background; there is no polling and no telemetry. Variables in the active environment (`{{var}}`) are substituted into the outgoing request locally before it is sent.

**Storage:** collections, environments (including any tokens/passwords you store as variables or auth values), and the last 50 sends of history persist in `localStorage` under `devtool:apiclient:*`. This is local to your machine and not encrypted — treat it like any local config file.

**Scripting (Bruno-style):** each request can have a pre-request script, a post-response script, a test script, declarative variable extractions, and declarative assertions. Collections and folders can also carry pre/post scripts that are **inherited** by every request inside them (edit via the collection ⋮ menu → Scripts, or a folder's `</>` action) — pre-request runs collection → folder → request, post-response unwinds in reverse. Scripts are JavaScript with a curated API in scope:

- `bru` — get/set runtime & environment variables (`getVar`/`setVar`, `getEnvVar`/`setEnvVar`)
- `req` — read/modify the outgoing request (`getUrl`/`setUrl`, `setHeader`, `setBody`, …)
- `res` — read the response (`getStatus`, `getBody`, `getHeader`, `responseTime`, …)
- `expect` / `test` / `assert` / `console`
- `require(...)` — a small set of bundled libraries: `lodash`, `crypto-js`, `uuid`
- `pm` — a Postman compatibility shim (`pm.environment`, `pm.variables`, `pm.response`, `pm.test`, `pm.expect`, …) so many imported Postman scripts run without rewriting

**Scripts execute locally in the app's own JavaScript context** (the same trust model as Postman/Bruno: they are your own scripts, run on your machine). They can read/modify only the request being sent and the variable stores; they never run on their own — only as part of a Send you initiate. `console.log` output and test results appear in the response panel. Runtime variables set via `bru.setVar` are session-only and cleared on app restart; `bru.setEnvVar` writes persist to the active environment in `localStorage`.

**Postman compatibility:** import reads Postman Collection **v2.1** JSON (folders, requests, headers, query, body, bearer/basic auth, and pre-request/test scripts); export writes the same format. Postman scripts use the `pm.*` API — the script text is preserved on import so you can adapt it to Bruno's `bru`/`req`/`res` API. Import/export use the native file picker (desktop) or browser file input/download (web).

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

## What never happens in any tool

- **No telemetry, analytics, or crash reporting.** The only outbound network activity is: Kafka connections you initiate, DNS/IP lookups you initiate in Network Tools, HTTP requests you send from the API Client, and the app update check described below.
- **Daily auto-update check, on by default.** The auto-update check (Settings → About → Auto-check for updates) is **enabled by default** and contacts the GitHub Releases API at most once per day (plus whenever you click "Check"). It downloads or installs nothing without your action, and you can turn it off in Settings.
- **No input data is sent to any server, except where a tool's whole purpose is a network query.** Computation — hashing, encoding, diffing, JWT decoding, regex matching — runs locally in the WebView or in Rust and never leaves the machine. The exceptions are explicit, user-initiated network tools: Kafka Explorer (broker traffic) and Network Tools (the single domain/IP you look up).
- **No background file access.** No tool reads files except when you explicitly click "Browse", drag a file, or use a file input.

---

*Last updated: 2026-06-18*
