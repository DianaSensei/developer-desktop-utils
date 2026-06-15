# DevTool — Setup, Build & Troubleshooting

## Platform Requirements

| Platform | Minimum version | Build output |
|----------|----------------|-------------|
| macOS (Apple Silicon) | macOS 11 (Big Sur) | `.dmg`, `.app` |
| Windows | Windows 10 / 11 | `.msi`, `.exe` (NSIS) |
| Linux | Ubuntu 22.04+ | `.AppImage`, `.deb` |

---

## Prerequisites

### Node.js 20.19+ (Node 22 LTS recommended)

```bash
node --version  # Must be 20.19+ (Vite 8 requirement)
```

Download from [nodejs.org](https://nodejs.org/).

### Rust (stable)

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**Windows:** Download installer from [rustup.rs](https://rustup.rs/)

### System dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu 22.04+):**
```bash
sudo apt update && sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libjavascriptcoregtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    build-essential
```

**Windows:** Visual Studio C++ Build Tools + WebView2 (pre-installed on Win 10/11).

---

## Installation

```bash
git clone <repo-url>
cd devtool
npm install
```

---

## Running

```bash
npm run dev          # Web only — fast, no Rust compile, opens http://localhost:1420
npm run tauri:dev    # Full desktop app with hot reload
```

---

## Building

### Local build

```bash
npm run tauri:build
```

Artifacts in `src-tauri/target/release/bundle/`:

| Platform | File | Location |
|----------|------|----------|
| macOS | `.dmg` | `bundle/dmg/` |
| macOS | `.app` | `bundle/macos/` |
| Windows | `.msi` | `bundle/msi/` |
| Windows | `.exe` | `bundle/nsis/` |
| Linux | `.AppImage` | `bundle/appimage/` |
| Linux | `.deb` | `bundle/deb/` |

Approximate sizes: macOS DMG 50–80 MB · Windows MSI 60–100 MB · Linux AppImage 80–120 MB.

The first build takes 5–10 min (Rust compiles all dependencies from scratch). Subsequent builds are ~1 min.

### CI/CD via GitHub Actions

The workflow at `.github/workflows/release.yml` builds all platforms automatically on version tag push.

**One-time secret setup** — generate a signing keypair:
```bash
npm run tauri signer generate -- -w ~/.tauri/devtool.key
```

Add to GitHub repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/devtool.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you chose |

Set `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` to the public key printed above.

**Trigger a release:**
```bash
# Bump "version" in src-tauri/tauri.conf.json first, then:
git tag v0.2.0
git push origin main --tags
```

GitHub Actions creates a draft release with all platform binaries. Publish the draft when ready.

---

## Troubleshooting

### Setup / install

**`tauri: command not found`**
```bash
npm install   # reinstalls @tauri-apps/cli
```

**Rust compilation errors**
```bash
rustup update
```

**Linux: missing library / `libwebkit2gtk-4.0` errors**  
Tauri 2 requires `libwebkit2gtk-4.1-dev`, not `4.0`. Re-run the Linux apt install above.

---

### Dev server

**`Port 1420 is already in use`**
```bash
lsof -ti:1420 | xargs kill -9
```

**Hot reload not working**  
Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`), then restart the dev server.

**`Module not found` / `Cannot find module '@/...'`**  
Check `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` and restart the TypeScript server (`Cmd+Shift+P` → "TypeScript: Restart TS Server" in VSCode).

---

### Build

**Build fails — Rust not found**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**Build fails — icons not found**
```bash
npm run tauri icon <path-to-512x512-png>   # generates all required icon sizes
```

**Build succeeds but app shows blank screen**  
Try dev mode first (`npm run tauri:dev`). If that works, check `src-tauri/tauri.conf.json` for config errors, then run `cd src-tauri && cargo check` to surface Rust errors.

**Clean build (fixes mysterious Rust errors)**
```bash
cargo clean
npm run tauri:build
```

**Full clean (fixes mysterious npm errors)**
```bash
rm -rf node_modules package-lock.json
npm install
rm -rf src-tauri/target
npm run tauri:build
```

---

### Tools / features

**New tool doesn't appear in sidebar**  
Verify all three registration points have the same ID:
1. Entry in `TOOL_DEFS` in `src/lib/toolDefs.ts`
2. Route in `TOOL_ROUTES` in `App.tsx`
3. Key in `DEFAULT_FEATURES` in `src/contexts/FeatureContext.tsx`

Clear stale localStorage if the ID changed: open DevTools console and run `localStorage.clear()`, then refresh.

**Feature toggle doesn't hide/show the tool**  
Check `FeatureProvider` wraps the router in `App.tsx`. Debug in console: `localStorage.getItem('devtool-features')`.

**Settings not persisting after refresh**  
Check the browser allows localStorage (incognito mode blocks it).

---

### Styling

**Tailwind classes not applying**  
Confirm `tailwind.config.js` content glob covers your file, then restart the dev server.

**Dark mode not toggling**  
Debug in console: `document.documentElement.classList.contains('dark')` and `localStorage.getItem('devtool-dark-mode')`.

---

### Tauri-specific

**Clipboard API not working**  
Add to `src-tauri/capabilities/default.json`:
```json
"clipboard-manager:allow-read-text",
"clipboard-manager:allow-write-text"
```
Use `@tauri-apps/plugin-clipboard-manager`, not the old `@tauri-apps/api/clipboard`.

**Permission denied (fs / dialog / process)**  
Add the required permission string to `src-tauri/capabilities/default.json`. The build error message prints the valid strings. Common ones:
```json
"fs:allow-read-file", "fs:allow-write-file", "fs:scope-appdata-recursive",
"dialog:allow-open", "dialog:allow-save", "process:allow-restart"
```

**IPC invoke fails — `[tauri] command not found`**  
Register the command in `src-tauri/src/main.rs` with `tauri::generate_handler![your_command]`.

---

### TypeScript / IDE

**Errors in IDE but `npm run build` passes**  
Use workspace TypeScript: `Cmd+Shift+P` → "TypeScript: Select TypeScript Version" → "Use Workspace Version".

**`Maximum update depth exceeded`**  
A `setState` call is running on every render. Move it inside a `useEffect` with the appropriate dependency array.

---

*Last updated: 2026-06-15*
