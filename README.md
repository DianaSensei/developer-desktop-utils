# DevTool

A cross-platform desktop app for developers — 17 offline utilities in a clean, fast interface. Built with Tauri 2 + React + TypeScript.

[![Release](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/release.yml/badge.svg)](https://github.com/DianaSensei/developer-desktop-utils/actions/workflows/release.yml)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Platform Support

| Platform | Minimum Version | Formats |
|----------|----------------|---------|
| macOS | 11 (Big Sur) | `.dmg` — Intel (x86_64) and Apple Silicon (aarch64) |
| Windows | 10 / 11 | `.msi`, `.exe` (NSIS) |
| Linux | Ubuntu 22.04+ | `.AppImage`, `.deb` |

All processing runs **locally**. No data leaves your machine.

> **macOS note:** The app is not yet notarized with an Apple Developer certificate. If macOS says _"DevTool is damaged and can't be opened"_, run this once in Terminal after moving the app to Applications:
> ```bash
> xattr -cr /Applications/DevTool.app
> ```

---

## Tools

| Tool | Description |
|------|-------------|
| Cron Generator | Build cron expressions with a visual editor and human-readable output |
| Text Transformer | Convert between single-line, multi-line, array, and case formats |
| Text Counter | Count characters, words, lines, and sentences in real time |
| Color Picker | Pick colors and get HEX, RGB, and HSL values |
| Encoder / Decoder | Base64, URL, HTML, Hex, Morse encode and decode |
| Hash & Encrypt | MD5, SHA-1, SHA-256, SHA-512 hashes and AES encryption |
| Date / Time | Convert timestamps, diff dates, format across timezones |
| JSON Formatter | Beautify, minify, stringify, and tree-view JSON |
| JWT Debugger | Decode and inspect JWT header, payload, and signature |
| Regex Tester | Test regex patterns with live match highlighting |
| Text Diff | Side-by-side text comparison |
| QR Code | Generate QR codes with custom frames and logo overlays |
| Markdown | Live markdown preview |
| Deduplicate | Remove duplicate lines or array items |
| Checksum | Compute MD5/SHA checksums for any file |
| Image ↔ Base64 | Encode images to Base64 or decode Base64 back to images |
| Generator | Generate UUIDs, random numbers, and random text |

---

## Quick Start

**Prerequisites:** Node.js 18+, Rust (stable)

```bash
npm install

# Web only (fast iteration)
npm run dev

# Desktop app
npm run tauri:dev
```

---

## Releasing a New Version

Releases are built automatically by GitHub Actions for macOS (Apple Silicon), Windows, and Linux when you push a version tag.

### 1. One-time setup (before your first release)

**Generate a signing keypair:**
```bash
npm run tauri signer generate -- -w ~/.tauri/devtool.key
```

Add two secrets to your GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/devtool.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you chose (leave empty if none) |

**Fill in `src-tauri/tauri.conf.json`:**
- Set `plugins.updater.pubkey` to the public key printed by the generator
- Set `plugins.updater.endpoints[0]` to `https://github.com/YOUR_ORG/YOUR_REPO/releases/latest/download/latest.json`

### 2. Ship a release

```bash
# Bump version in src-tauri/tauri.conf.json → "version": "0.2.0"
git commit -am "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags
```

GitHub Actions builds all platforms in parallel (~10–15 min) and creates a **draft release** with:
- `.dmg` — macOS Apple Silicon (aarch64)
- `.msi` / `.exe` — Windows
- `.AppImage` / `.deb` — Linux
- `latest.json` — update manifest for the in-app updater

Review the draft on GitHub Releases, then publish it. Users already running the app will see the update prompt in **Settings → Updates**.

> **Version note:** The app version is controlled by `src-tauri/tauri.conf.json` → `"version"`. The GitHub tag must match it. `package.json` version has no effect on the built binary or updater.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | [Tauri 2](https://tauri.app) — Rust-backed, lightweight native shell |
| Frontend | [React 18](https://react.dev) + [TypeScript](https://typescriptlang.org) |
| Build | [Vite 5](https://vitejs.dev) |
| Styling | [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) |
| Routing | [React Router v6](https://reactrouter.com) |

---

## Development

```bash
npm run dev           # Vite dev server (web only, http://localhost:1420)
npm run tauri:dev     # Full desktop app with hot reload
npm run tauri:build   # Production build
npx tsc --noEmit      # Type check
```

### Adding a tool

1. Create `src/components/tools/YourTool.tsx` — use `usePersistentState`, `useQuickPaste`, `useInputHistory` hooks
2. Add entry to `allTools` in `src/App.tsx`
3. Add `'your-tool': true` to `DEFAULT_FEATURES` in `src/contexts/FeatureContext.tsx`
4. Add entry to `FEATURE_LIST` in `src/components/Settings.tsx`

See [docs/human/CONTRIBUTING.md](docs/human/CONTRIBUTING.md) for a full walkthrough and [docs/ai/CLAUDE.md](docs/ai/CLAUDE.md) for the AI agent guide.

---

## License

[MIT](LICENSE) — free for personal and commercial use.
