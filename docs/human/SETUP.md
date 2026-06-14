# DevTool Setup Guide

## Platform Requirements

| Platform | Minimum Version |
|----------|----------------|
| macOS | 11 (Big Sur) |
| Windows | 10 / 11 |
| Linux | Ubuntu 22.04+ |

## Prerequisites

### 1. Node.js 18+

```bash
node --version  # Must be 18.x or higher
```

Download from [nodejs.org](https://nodejs.org/) if not installed.

### 2. Rust (stable)

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**Windows:** Download from [rustup.rs](https://rustup.rs/)

Verify:
```bash
rustc --version
cargo --version
```

### 3. System Dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu 22.04+):**
```bash
sudo apt update
sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libjavascriptcoregtk-4.1-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf
```

**Windows:**
- Visual Studio C++ Build Tools
- WebView2 (pre-installed on Windows 10/11)

---

## Installation

```bash
git clone https://github.com/DianaSensei/developer-desktop-utils.git
cd developer-desktop-utils
npm install
```

## Running

```bash
# Web only (fast, no Rust compile)
npm run dev

# Full desktop app with hot reload
npm run tauri:dev
```

## Production Build

```bash
npm run tauri:build
```

Output in `src-tauri/target/release/bundle/`.

---

## Troubleshooting

### `tauri: command not found`
```bash
npm install  # reinstalls @tauri-apps/cli
```

### Rust compilation errors
```bash
rustup update
```

### Linux: missing library errors
Make sure you installed `libwebkit2gtk-4.1-dev` (not `4.0`). Tauri 2 requires the 4.1 version.

---

*Last updated: 2026-06-14*
