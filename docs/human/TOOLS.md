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
| Encoder / Decoder | ✓ | — | — | — | Input (localStorage) |
| Hash & Encrypt | ✓ | — | — | — | Input (localStorage) |
| Date / Time | ✓ | — | — | — | Input (localStorage) |
| JSON Formatter | ✓ | — | — | — | Input (localStorage) |
| JWT Debugger | — | — | — | — | Input (localStorage) |
| Regex Tester | — | — | — | — | Input (localStorage) |
| Text Diff | — | — | — | — | Input (localStorage) |
| Markdown Preview | — | — | — | — | Input (localStorage) |
| Array Deduplicator | ✓ | — | — | — | Input (localStorage) |
| Generator | ✓ | — | — | — | Mode pref (localStorage) |
| Checksum | ✓ | ✓ | — | — | — |
| Image ↔ Base64 | ✓ | ✓ (browser) | — | — | — |
| QR Code | ✓ (image) | ✓ | ✓ | — | — |
| Kafka Explorer | ✓ | — | — | **✓ TCP** | Broker configs (app data) |

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

**OS / system impact:** clipboard write only.

---

### Hash & Encrypt

Computes **MD5, SHA-1, SHA-256, SHA-512** hashes of typed/pasted text using the `crypto-js` library (JavaScript — not the browser's Web Crypto API). Also encrypts/decrypts text with **AES** using a passphrase.

> Note: this tool hashes **text you type or paste**, not files. For file checksums, use the Checksum tool.

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

## Tools with file system access

### Checksum

Computes MD5, SHA-1, SHA-256, or SHA-512 checksums of a file you select. Supports files of any size via chunked reading with a live progress bar.

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

Converts images to and from base64 data URLs. You can also preview a pasted base64 string as an image.

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

Opens TCP connections to Kafka brokers you configure. All network activity is user-initiated — there is no background polling or auto-connect on launch.

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

## What never happens in any tool

- **No telemetry, analytics, or crash reporting.** The only network activity is Kafka connections you explicitly initiate and the app update check described below.
- **Daily auto-update check, on by default.** The auto-update check (Settings → About → Auto-check for updates) is **enabled by default** and contacts the GitHub Releases API at most once per day (plus whenever you click "Check"). It downloads or installs nothing without your action, and you can turn it off in Settings.
- **No input data is sent to any server.** Every computation — hashing, encoding, diffing, JWT decoding, regex matching — runs locally in the WebView or in Rust. Your input data does not leave the machine; the update check sends only a version request, never your data.
- **No background file access.** No tool reads files except when you explicitly click "Browse", drag a file, or use a file input.

---

*Last updated: 2026-06-15*
