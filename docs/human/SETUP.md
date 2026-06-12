# DevTool Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed:

### 1. Node.js and npm
```bash
node --version  # Should be 18.x or higher
npm --version
```

If not installed, download from [nodejs.org](https://nodejs.org/)

### 2. Rust and Cargo (for Tauri)

**macOS/Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Windows:**
Download and install from [rustup.rs](https://rustup.rs/)

Verify installation:
```bash
rustc --version
cargo --version
```

### 3. System Dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
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

**Windows:**
- Install Visual Studio C++ Build Tools
- Install WebView2 (usually pre-installed on Windows 10/11)

## Installation

1. Clone or navigate to the project directory:
```bash
cd /Users/thongnguyen/Documents/GitHub/devtool
```

2. Install dependencies (if not already done):
```bash
npm install
```

3. Run in development mode:
```bash
npm run tauri:dev
```

This will:
- Start the Vite development server
- Compile the Rust backend
- Open the desktop application

## Building for Production

To create a distributable application:

```bash
npm run tauri:build
```

The built application will be in `src-tauri/target/release/bundle/`

## Development Workflow

### Running the Web Version (without Tauri)
```bash
npm run dev
```
Then open http://localhost:1420 in your browser.

### Running the Desktop App
```bash
npm run tauri:dev
```

### Hot Reload
Changes to React components will hot-reload automatically. Rust changes require a restart.

## Troubleshooting

### "Command 'tauri' not found"
Make sure @tauri-apps/cli is installed:
```bash
npm install -D @tauri-apps/cli
```

### Rust Compilation Errors
Update Rust to the latest version:
```bash
rustup update
```

### Icons Missing
The app needs icons to build. See `src-tauri/icons/README.md` for instructions.

For development, you can skip icon generation, but you'll need them for distribution.

## Next Steps

- Read [README.md](README.md) for feature overview
- Read [CONTRIBUTING.md](CONTRIBUTING.md) to learn how to add new tools
- Explore the codebase in `src/components/tools/` to see examples
