# Building DevTool Binaries

## Platform Support

| Platform | Minimum OS | Output formats |
|----------|-----------|---------------|
| macOS (Apple Silicon) | macOS 11 (Big Sur) | `.dmg`, `.app` |
| Windows | Windows 10 / 11 | `.msi`, `.exe` (NSIS) |
| Linux | Ubuntu 22.04+ | `.AppImage`, `.deb` |

## Prerequisites

All platforms: Node.js 18+, Rust stable.

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

## Local Build

```bash
npm install
npm run tauri:build
```

Artifacts in `src-tauri/target/release/bundle/`.

---

## GitHub Actions (Recommended)

The workflow at `.github/workflows/release.yml` builds all platforms automatically on version tag push.

### One-time secret setup

Generate a signing keypair:
```bash
npm run tauri signer generate -- -w ~/.tauri/devtool.key
```

Add to GitHub repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/devtool.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you chose |

Set `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` to the public key printed above.

### Trigger a release

```bash
# Bump "version" in src-tauri/tauri.conf.json first, then:
git commit -am "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags
```

GitHub Actions will create a draft release with all platform binaries. Publish the draft when ready.

---

## Build Output

| Platform | File | Location |
|----------|------|----------|
| macOS | `.dmg` | `bundle/dmg/` |
| macOS | `.app` | `bundle/macos/` |
| Windows | `.msi` | `bundle/msi/` |
| Windows | `.exe` | `bundle/nsis/` |
| Linux | `.AppImage` | `bundle/appimage/` |
| Linux | `.deb` | `bundle/deb/` |

Approximate sizes: macOS DMG 50–80 MB · Windows MSI 60–100 MB · Linux AppImage 80–120 MB.

---

## Troubleshooting

### Clean build
```bash
cargo clean
npm run tauri:build
```

### Linux: `libwebkit2gtk-4.0` errors
Tauri 2 requires `libwebkit2gtk-4.1-dev`, not `4.0`. Re-run the apt install above.

### First build is slow
Normal — Rust compiles all dependencies from scratch (~5–10 min). Subsequent builds are ~1 min.

---

*Last updated: 2026-06-14*
