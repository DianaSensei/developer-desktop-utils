// Builds the devtool-mcp-server Rust binary (src-tauri/src/bin/devtool-mcp-server.rs)
// and copies it into src-tauri/binaries/ under the exact name Tauri's sidecar
// bundling (bundle.externalBin in tauri.conf.json) expects: the binary name
// suffixed with the current Rust target triple. Run before `tauri build` so
// the compiled app ships this binary — see package.json's "tauri:build".
//
// Not run before `tauri dev`: the sidecar is only needed by an external MCP
// client (Claude Code/Desktop) pointed at the installed app, not by the dev
// loop itself. To test it locally, run this script by hand, or use
// `cargo run --bin devtool-mcp-server` directly (see the checked-in
// .mcp.json, which does exactly that).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSidecar } from './sidecar.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
buildSidecar(root, 'devtool-mcp-server');
