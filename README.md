# DevTool

A fast, **offline-first** desktop toolbox for developers — 24 everyday utilities in one clean, native app. No accounts, no telemetry, no cloud. Built with Tauri 2 + React + TypeScript.

[![Latest release](https://img.shields.io/github/v/release/DianaSensei/developer-desktop-utils?sort=semver&display_name=tag&logo=github&label=release)](https://github.com/DianaSensei/developer-desktop-utils/releases/latest)
[![Release](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/release.yml/badge.svg)](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/release.yml)
[![Coverage](https://codecov.io/gh/DianaSensei/developer-desktop-utils/branch/main/graph/badge.svg)](https://codecov.io/gh/DianaSensei/developer-desktop-utils)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Download & Install

Grab the latest build for your OS from the [**Releases**](https://github.com/DianaSensei/developer-desktop-utils/releases) page.

| Platform | Minimum version | Formats |
|----------|-----------------|---------|
| macOS | 11 (Big Sur) | `.dmg` — Intel (x86_64) & Apple Silicon (aarch64) |
| Windows | 10 / 11 | `.msi`, `.exe` (NSIS) |
| Linux | Ubuntu 22.04+ | `.AppImage`, `.deb` |

The app is **~3–10 MB** (Tauri uses your OS's native WebView instead of bundling a browser) and updates in place via a signed in-app updater (**Settings → Updates**).

> **macOS note:** the app is not yet notarized with an Apple Developer certificate. If macOS says _"DevTool is damaged and can't be opened"_, run this once after moving it to Applications:
> ```bash
> xattr -cr /Applications/DevTool.app
> ```

---

## Tools

24 tools, grouped by what they do. Everything runs locally; the few tools that reach the network are marked 🌐 and only act when you tell them to.

### Text & data
| Tool | What it does |
|------|--------------|
| **Text Transformer** | Convert case; sort, trim, reverse; switch between single-line / multi-line / array forms |
| **Text Counter** | Live character, word, line, and sentence counts with reading-time estimate |
| **Deduplicate** | Remove duplicate lines or list items |
| **Text Diff** | Side-by-side comparison with additions/removals highlighted |
| **Regex Tester** | Live match highlighting and capture-group inspection |
| **JSON Formatter** | Beautify, minify, validate, and tree-explore JSON |
| **SQL Formatter** | Format SQL with keyword casing, space collapse, and clause line breaks |
| **Markdown** | Live Markdown preview |

### Encoding, hashing & crypto
| Tool | What it does |
|------|--------------|
| **Encode·Hash·Encrypt** | Base64 / URL / Hex / Morse encode-decode, MD5 / SHA / HMAC hashing, and AES-256 encrypt-decrypt |
| **JWT Debugger** | Decode and inspect JWT header & payload (no verification) |
| **Checksum** | Compute MD5 / SHA-1 / SHA-256 / SHA-512 for any file |
| **Image ↔ Base64** | Encode images to Base64 and render Base64 back to images |
| **2FA Authenticator** | Generate TOTP / HOTP codes (SHA-1/256/512, 6/8 digits, 30/60s) |

### Generators & pickers
| Tool | What it does |
|------|--------------|
| **Generator** | UUIDs, random numbers, and random text with custom character sets |
| **Cron Generator** | Build & validate cron expressions with a visual editor |
| **QR Code** | Generate QR codes from text/URL (download PNG) or read one from an image |
| **Color Picker** | Pick colors and convert between HEX, RGB, HSL, HSV |
| **Lucky Wheel** | Spin a wheel of your own choices to pick a random winner |

### Time & productivity
| Tool | What it does |
|------|--------------|
| **Time Tracker** | Time tracking with timesheet and calendar views, projects, tags, and pomodoro |
| **Meeting Notes** | Create & search timed meeting minutes that sync with the Time Tracker calendar and export to Markdown |
| **Date / Time** | Convert timestamps, diff dates, format across any timezone |

### Network & services
| Tool | What it does |
|------|--------------|
| **API Client** 🌐 | Postman/Bruno-style HTTP workbench — collections, environments with `{{vars}}`, auth, pre/post scripts, tests, Postman import/export |
| **Kafka Explorer** 🌐 | Browse topics, inspect partitions & offsets, view consumer groups, and produce messages |
| **Network Tools** 🌐 | DNS records (A/AAAA/CNAME/NS/TXT/SOA/SRV/CAA…), propagation & DNSSEC checks, what's-my-IP, IP geolocation, local network info |

---

## Privacy

DevTool is **local-first by design**:

- **No account, no sign-in, no telemetry, no analytics, no crash reporting** — nothing phones home.
- **Your data stays on your machine.** Inputs, time entries, meeting notes, saved broker configs, and API collections are stored in the app's local storage / data directory and never leave your device.
- **The only outbound traffic is user-initiated**, limited to these tools:
  - **API Client** — requests go only to the URLs you send them to.
  - **Kafka Explorer** — connects only to the brokers you configure (plaintext; no TLS/SASL).
  - **Network Tools** — runs the DNS-over-HTTPS / IP-geolocation lookups you trigger.
  - **App updater** — an optional check against GitHub Releases (toggle in **Settings → Updates**).
- **Every other tool runs 100% offline** — text, encoding, hashing, crypto, JSON/JWT/regex/diff, checksums, generators, QR, color, time tracking, etc. make no network requests at all.

A full per-tool breakdown (clipboard, file, network, what's stored) is in [docs/human/TOOLS.md](docs/human/TOOLS.md).

---

## Security

- **Least-privilege native access.** Built on Tauri 2's capability system — the app is granted only the narrowest OS permissions each feature needs (e.g. `fs:allow-read-file`, never blanket file access). The full grant list is visible in **Settings → App Permissions**.
- **Sandboxed architecture.** The UI runs in the OS WebView; all system access goes through a small, explicit Rust command layer — no arbitrary shell execution and no bundled Node runtime.
- **Credentials stay local.** Secrets you enter (Kafka SASL, API Client auth/tokens) are stored on your machine and sent only to the service you target. They are kept in the local app data, not encrypted at rest — treat your machine as the trust boundary, just as you would a local `.env` or config file.
- **Signed updates.** Release binaries and the update manifest are cryptographically signed; the in-app updater verifies the signature before applying an update.
- **Open source & auditable.** The entire codebase is public — nothing closed is fetched or executed at runtime.

Found a security issue? Please open a private report via the repository's **Security → Report a vulnerability** tab rather than a public issue.

---

## Build from source

Prefer to build it yourself? The full guide — prerequisites, install, run, build installers, release process, and troubleshooting — lives in **[docs/human/SETUP.md](docs/human/SETUP.md)**.

Quick start (Node 20.19+ and Rust stable required):

```bash
git clone https://github.com/DianaSensei/developer-desktop-utils.git
cd developer-desktop-utils
npm ci
npm run tauri:dev     # full desktop app with hot reload
```

To build distributable installers: `npm run tauri:build` → output in `src-tauri/target/release/bundle/`.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop | [Tauri 2](https://tauri.app) — Rust-backed, lightweight native shell |
| Frontend | [React 18](https://react.dev) + [TypeScript](https://typescriptlang.org) |
| Build | [Vite 8](https://vitejs.dev) (Rolldown bundler) |
| Styling | [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) |
| Routing | [React Router v6](https://reactrouter.com) |

---

## Contributing & docs

- **[docs/human/SETUP.md](docs/human/SETUP.md)** — setup, build & troubleshooting
- **[docs/human/CONTRIBUTING.md](docs/human/CONTRIBUTING.md)** — how to add a tool, step by step
- **[docs/human/TOOLS.md](docs/human/TOOLS.md)** — per-tool system access, permissions & storage
- **[docs/human/kafka-explorer.md](docs/human/kafka-explorer.md)** — Kafka Explorer operation reference
- **[docs/design/DESIGN-SYSTEM.md](docs/design/DESIGN-SYSTEM.md)** — design system: tokens, utilities & components
- **[docs/ai/CLAUDE.md](docs/ai/CLAUDE.md)** — guide for AI coding agents

---

## License

[MIT](LICENSE) — free for personal and commercial use.
