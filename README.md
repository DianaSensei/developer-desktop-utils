# DevTool

A fast, **offline-first** desktop toolbox for developers — 24 everyday utilities in one clean, native app. No accounts, no telemetry, no cloud. Built with Tauri 2 + React + TypeScript.

[![Latest release](https://img.shields.io/github/v/release/DianaSensei/developer-desktop-utils?sort=semver&display_name=tag&logo=github&label=release)](https://github.com/DianaSensei/developer-desktop-utils/releases/latest)
[![Release](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/release.yml/badge.svg)](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/release.yml)
[![Coverage](https://codecov.io/gh/DianaSensei/developer-desktop-utils/branch/main/graph/badge.svg)](https://codecov.io/gh/DianaSensei/developer-desktop-utils)
[![Security](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/security.yml/badge.svg)](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/DianaSensei/developer-desktop-utils/badge)](https://scorecard.dev/viewer/?uri=github.com/DianaSensei/developer-desktop-utils)
[![Known vulnerabilities](https://snyk.io/test/github/DianaSensei/developer-desktop-utils/badge.svg)](https://snyk.io/test/github/DianaSensei/developer-desktop-utils)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Download & Install

Grab the latest build for your OS from the [**Releases**](https://github.com/DianaSensei/developer-desktop-utils/releases) page.

| Platform | Minimum version | Formats |
|----------|-----------------|---------|
| macOS | 11 (Big Sur) | `.dmg` — Intel (x86_64) & Apple Silicon (aarch64) |
| Windows | 10 / 11 | `.exe` (NSIS) |
| Linux | Ubuntu 22.04+ | `.AppImage`, `.deb` |

The app is **~3–10 MB** (Tauri uses your OS's native WebView instead of bundling a browser) and updates in place via a signed in-app updater (**Settings → Updates**).

> **macOS note:** the app is not yet notarized with an Apple Developer certificate. If macOS says _"DevTool is damaged and can't be opened"_, run this once after moving it to Applications:
> ```bash
> xattr -cr /Applications/DevTool.app
> ```

---

## Tools

24 tools, all local-first. Full descriptions and per-tool system access live in **[docs/human/TOOLS.md](docs/human/TOOLS.md)**; the few that reach the network (marked 🌐) only act when you tell them to.

- **Text & data** — Text Transformer, Text Counter, Deduplicate, Text Diff, Regex Tester, JSON Formatter, SQL Formatter, Markdown
- **Encoding, hashing & crypto** — Encode·Hash·Encrypt, JWT Debugger, Checksum, Image ↔ Base64, 2FA Authenticator
- **Generators & pickers** — Generator, Cron Generator, QR Code, Color Picker, Lucky Wheel
- **Time & productivity** — Time Tracker, Meeting Notes, Date / Time
- **Network & services** 🌐 — API Client, Kafka Explorer, Network Tools

---

## Privacy

Local-first by design: **no account, no telemetry, no analytics, no crash reporting.** Your data (time entries, meeting notes, broker configs, API collections) stays in the app's local storage and never leaves your device.

The only outbound traffic is what you trigger yourself — API Client requests, Kafka Explorer connections, Network Tools lookups, and the optional update check. Every other tool is 100% offline. Full breakdown: **[docs/human/TOOLS.md](docs/human/TOOLS.md)**.

---

## Security

Built on Tauri 2's least-privilege capability system (no blanket file/shell access), a sandboxed Rust command layer, and signed, attested release binaries. Credentials you enter stay local and unencrypted at rest — treat your machine as the trust boundary.

Verify any of this yourself:

```bash
gh attestation verify ./DevTool_1.0.0_aarch64.dmg --repo DianaSensei/developer-desktop-utils   # provenance
./scripts/verify-release.sh v1.0.0                                                              # provenance + checksums
./scripts/check-security-claims.sh                                                              # re-run the claims below
```

Every release ships an SPDX SBOM; every push is scanned by CodeQL, `npm audit`, `cargo audit`, and a secret scanner.

**[SECURITY.md](SECURITY.md)** has the full threat model and an honest list of limitations. Found a vulnerability? Use the repo's **Security → Report a vulnerability** tab, not a public issue.

---

## Build from source

```bash
git clone https://github.com/DianaSensei/developer-desktop-utils.git
cd developer-desktop-utils
npm ci
npm run tauri:dev     # full desktop app with hot reload
```

Needs Node 20.19+ and Rust stable. `npm run tauri:build` produces installers in `src-tauri/target/release/bundle/`. Full guide (prerequisites, troubleshooting, release process): **[docs/human/SETUP.md](docs/human/SETUP.md)**.

**Stack:** [Tauri 2](https://tauri.app) · [React 18](https://react.dev) + [TypeScript](https://typescriptlang.org) · [Vite 8](https://vitejs.dev) · [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) · [React Router v6](https://reactrouter.com)

---

## Docs

- **[SECURITY.md](SECURITY.md)** — threat model, supply-chain guarantees & how to verify a build
- **[docs/human/SETUP.md](docs/human/SETUP.md)** — setup, build & troubleshooting
- **[docs/human/CONTRIBUTING.md](docs/human/CONTRIBUTING.md)** — how to add a tool, step by step
- **[docs/human/TOOLS.md](docs/human/TOOLS.md)** — per-tool system access, permissions & storage
- **[docs/human/kafka-explorer.md](docs/human/kafka-explorer.md)** — Kafka Explorer operation reference
- **[docs/design/DESIGN-SYSTEM.md](docs/design/DESIGN-SYSTEM.md)** — design system: tokens, utilities & components
- **[docs/ai/CLAUDE.md](docs/ai/CLAUDE.md)** — guide for AI coding agents

---

## License

[MIT](LICENSE) — free for personal and commercial use.
