# DevTool

A cross-platform desktop app for developers — 17 offline utilities in a clean, fast interface. Built with Tauri + React + TypeScript.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)

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

All processing runs locally. No data leaves your machine.

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

Releases are built automatically by GitHub Actions for macOS (Intel + Apple Silicon), Windows, and Linux when you push a version tag.

### 1. One-time setup (do this before your first release)

**Generate a signing keypair:**
```bash
npx tauri signer generate -w ~/.tauri/devtool.key
```

Add two secrets to your GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `TAURI_PRIVATE_KEY` | Contents of `~/.tauri/devtool.key` |
| `TAURI_KEY_PASSWORD` | Password you chose (leave empty if none) |

**Fill in `src-tauri/tauri.conf.json`:**
- Set `updater.pubkey` to the public key printed by the generator
- Set `updater.endpoints[0]` to `https://github.com/YOUR_ORG/YOUR_REPO/releases/latest/download/latest.json`

### 2. Ship a release

```bash
# Bump version in src-tauri/tauri.conf.json → "version": "0.2.0"
git commit -am "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags
```

GitHub Actions will build all platforms in parallel (~10–15 min) and create a **draft release** with:
- `.dmg` — macOS (Intel + Apple Silicon)
- `.msi` / `.exe` — Windows
- `.AppImage` / `.deb` — Linux
- `latest.json` — update manifest for the in-app updater

Review the draft on GitHub Releases, then publish it. Users already running the app will see the update prompt in **Settings → Updates**.

### Version note

The app version is controlled by `src-tauri/tauri.conf.json` → `package.version`. The GitHub tag should match it. `package.json` version has no effect on the built binary or the updater.

---

## Tech Stack

- [Tauri](https://tauri.app) — lightweight Rust-backed desktop framework
- [React 18](https://react.dev) + [TypeScript](https://typescriptlang.org)
- [Vite](https://vitejs.dev) — build tool
- [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) — styling
- [React Router v6](https://reactrouter.com) — routing

---

## Development

```bash
npm run dev           # Vite dev server (web only, http://localhost:1420)
npm run tauri:dev     # Full desktop app with hot reload
npm run tauri:build   # Production build
npx tsc --noEmit      # Type check (run before committing)
```

### Adding a tool

1. Create `src/components/tools/YourTool.tsx`
2. Add entry to `TOOL_DEFS` in `src/lib/toolDefs.ts`
3. Add entry to `TOOL_ROUTES` in `src/App.tsx`
4. Add `'your-tool': true` to `DEFAULT_FEATURES` in `src/contexts/FeatureContext.tsx`

See [docs/human/CONTRIBUTING.md](docs/human/CONTRIBUTING.md) for a full walkthrough and [docs/ai/CLAUDE.md](docs/ai/CLAUDE.md) for the AI agent guide.

---

## License

MIT
