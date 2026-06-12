# Building DevTool Binaries

This guide explains how to build distributable binaries for macOS, Windows, and Linux/Ubuntu.

## Prerequisites

### All Platforms

- Node.js 18+ and npm
- Rust and Cargo (latest stable)

### macOS

```bash
xcode-select --install
```

### Windows

- Visual Studio C++ Build Tools
- WebView2 (usually pre-installed on Windows 10/11)

### Ubuntu/Linux

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

---

## Build Options

### Option 1: Local Build on Each Platform (Simplest)

Build on the platform you're targeting:

```bash
npm run tauri:build
```

**Outputs:**

**macOS:**

- `DevTool_0.1.0_x64.dmg` - DMG installer (drag & drop install)
- `DevTool.app` - Unsigned app bundle

**Windows:**

- `DevTool_0.1.0_x64-setup.exe` - NSIS installer
- `DevTool_0.1.0_x64.msi` - MSI installer

**Linux:**

- `devtool_0.1.0_amd64.AppImage` - Portable executable
- `devtool_0.1.0_amd64.deb` - Debian package

All artifacts are in `src-tauri/target/release/bundle/`

---

### Option 2: GitHub Actions (Recommended for Continuous Build)

We've set up a GitHub Actions workflow that automatically builds for all platforms.

**Setup:**

1. Initialize a git repository and push to GitHub:

```bash
cd /Users/thongnguyen/Documents/GitHub/devtool
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/devtool.git
git push -u origin main
```

2. Create a release tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions will automatically:
   - Build for macOS (Intel & ARM/M1+)
   - Build for Windows
   - Build for Linux
   - Create a GitHub Release with all binaries

The workflow file is already at `.github/workflows/release.yml`

---

### Option 3: Cross-Compilation (Advanced)

For building Windows & Linux binaries from macOS:

```bash
# Install cross-compilation tools
cargo install cross

# Build for different targets
cross build --target x86_64-pc-windows-gnu --release
cross build --target x86_64-unknown-linux-gnu --release
cross build --target x86_64-apple-darwin --release
```

This requires Docker and is more complex - not recommended unless you need it.

---

## Step-by-Step: Build on macOS

1. **Ensure dependencies are installed:**

```bash
cargo --version
npm --version
```

2. **Generate icons** (optional but recommended for production):

```bash
# Create a 512x512 PNG icon named icon.png
# Then run:
npm install -g @tauri-apps/cli
tauri icon src-tauri/icons/icon.png
```

3. **Build the app:**

```bash
npm run tauri:build
```

4. **Wait for compilation** (first time takes 2-5 minutes):

```
Building for macOS...
Compiling devtool v0.1.0...
```

5. **Find your artifacts:**

```bash
ls -lh src-tauri/target/release/bundle/dmg/
ls -lh src-tauri/target/release/bundle/macos/
```

6. **Test the built app:**

```bash
open src-tauri/target/release/bundle/macos/DevTool.app
```

---

## Step-by-Step: Build on Windows

Same process as macOS, but use:

```bash
npm run tauri:build
```

Find artifacts in:

- `src-tauri\target\release\bundle\msi\`
- `src-tauri\target\release\bundle\nsis\`

---

## Step-by-Step: Build on Ubuntu/Linux

1. **Install dependencies:**

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

2. **Build:**

```bash
npm run tauri:build
```

3. **Find artifacts:**

```bash
ls -lh src-tauri/target/release/bundle/deb/
ls -lh src-tauri/target/release/bundle/appimage/
```

4. **Test AppImage:**

```bash
./src-tauri/target/release/bundle/appimage/devtool_0.1.0_amd64.AppImage
```

---

## Signing & Notarization

### macOS Code Signing (for distribution)

For users outside your organization, you need code signing:

```bash
# Generate a certificate (requires Apple Developer account)
# Follow: https://tauri.app/en/v1/guides/distribution/sign-macos/

export APPLE_CERTIFICATE="<certificate_base64>"
export APPLE_CERTIFICATE_PASSWORD="<password>"
export APPLE_SIGNING_IDENTITY="<identity>"
npm run tauri:build
```

### Windows Code Signing

```bash
export WINDOWS_CERTIFICATE_FILE="<path_to_cert>"
export WINDOWS_CERTIFICATE_PASSWORD="<password>"
npm run tauri:build
```

---

## Distribution Channels

### Direct Download

- Create a GitHub Release
- Upload DMG, EXE, AppImage, and DEB files
- Users download and install manually

### Package Managers

**macOS Homebrew:**

```bash
brew tap yourusername/devtool
brew install devtool
```

**Ubuntu/Debian:**
Host the .deb file in a PPA or personal repository

**Windows Chocolatey:**
Submit your MSI to Chocolatey repository

---

## Troubleshooting Build Issues

### "cargo not found"

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### "Icons not found"

Set `"bundle": { "active": false }` in `src-tauri/tauri.conf.json` for dev builds (already done for you)

### Build succeeds but app won't start

- Check console for errors: `npm run tauri:dev`
- Verify all dependencies are installed
- Try a clean build: `cargo clean && npm run tauri:build`

### Out of disk space

Rust builds are large (~8-15 GB). Free up space or use:

```bash
cargo clean
```

---

## Build Output Summary

| Platform | File Type | Location                     | Size       |
| -------- | --------- | ---------------------------- | ---------- |
| macOS    | DMG       | `bundle/dmg/*.dmg`           | 50-80 MB   |
| macOS    | App       | `bundle/macos/*.app`         | 200-300 MB |
| Windows  | MSI       | `bundle/msi/*.msi`           | 60-100 MB  |
| Windows  | EXE       | `bundle/nsis/*.exe`          | 60-100 MB  |
| Linux    | AppImage  | `bundle/appimage/*.AppImage` | 80-120 MB  |
| Linux    | DEB       | `bundle/deb/*.deb`           | 40-60 MB   |

---

## Quick Commands Reference

```bash
# Development
npm run tauri:dev

# Production build
npm run tauri:build

# Clean build (if having issues)
cargo clean && npm run tauri:build

# Check for compilation errors
cargo check

# Build for specific platform (must be on that platform)
npm run tauri:build -- --target universal-apple-darwin  # macOS Intel + ARM
```

---

## Next Steps

1. **Test locally** on each platform with `npm run tauri:build`
2. **Set up GitHub Actions** for automated builds
3. **Sign binaries** for production distribution
4. **Create release notes** for each version
5. **Distribute** through GitHub Releases or package managers
