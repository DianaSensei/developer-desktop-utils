// Builds every tier-B plugin service sidecar (src-tauri/src/bin/devtool-svc-*.rs)
// and copies each into src-tauri/binaries/ — same convention as
// prepare-mcp-sidecar.mjs. Run before `tauri build` (wired into
// beforeBuildCommand in tauri.conf.json) so the app ships every sidecar it
// might spawn.
//
// SERVICE_SIDECARS below must be kept in sync BY HAND with `ALLOWED_SERVICES`
// in src-tauri/src/service_host.rs — Rust and Node don't share constants
// across the language boundary. Missing an entry here doesn't fail this
// script; it fails later, as a runtime "sidecar not found" for anyone who
// installs the built app (service_host.rs's own `allowlist_khop_voi_external_bin`
// test only checks the tauri.conf.json side, not this list).
//
// Not run before `tauri dev`: `tauri dev` only builds the `devtool` bin
// target (default-run), not sibling bins, so a sidecar isn't sitting next to
// the dev binary unless you build it yourself — `service_host::sidecar_path`
// says exactly that ("chạy `cargo build --bin <bin>`") when a call can't find
// one. Test a sidecar's own behavior with its integration test
// (`cargo test --test service_echo`, or the equivalent for a new one) rather
// than by running the desktop app.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSidecar } from './sidecar.mjs';

const SERVICE_SIDECARS = ['devtool-svc-echo'];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const bin of SERVICE_SIDECARS) buildSidecar(root, bin);
