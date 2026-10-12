// Builds the tier-B sidecars bundled with the app and copies them into
// src-tauri/binaries/ (see sidecar.mjs). Runs from beforeBuildCommand.
//
// Keep SERVICE_SIDECARS in sync with `BUNDLED_SERVICES` in
// src-tauri/src/service_host.rs and `bundle.externalBin` in tauri.conf.json.
//
// `tauri dev` builds only the `devtool` bin, so in development build a
// sidecar with `cargo build --bin <bin>`, or test it through its
// integration test (`cargo test --test service_echo`).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSidecar } from './sidecar.mjs';

// The redis/container/rabbit sidecars ship from developer-desktop-miniapp
// (docs/decisions/architecture/optional-broker-plugins.md).
const SERVICE_SIDECARS = ['devtool-svc-echo'];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const bin of SERVICE_SIDECARS) buildSidecar(root, bin);
