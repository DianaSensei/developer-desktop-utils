# Auditor's guide

A map of DevTool for someone reviewing it for security and correctness:
where the trust boundaries are, which files enforce them, how to verify
them, and what is known to be weak.

## Build and verify

| Check | Command |
|---|---|
| Typecheck | `npx tsc --noEmit -p .` |
| Frontend tests (vitest, jsdom) | `npm test` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Rust lints | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` |

Rust builds need the Tauri Linux dependencies (`libwebkit2gtk-4.1-dev` and
friends, see [`human/SETUP.md`](./human/SETUP.md)), the sidecar binaries
(`npm run build:mcp-sidecar && npm run build:service-sidecars`) and an
existing `dist/` directory.

CI: `.github/workflows/tests.yml` (tests), `security.yml`, `codeql.yml`,
`scorecard.yml`, `release.yml` (signed builds and updater manifest).

## Code map

```
src-tauri/                Rust host (Tauri 2)
  tauri.conf.json         CSP, updater endpoint + public key, bundled sidecars
  capabilities/           Tauri plugin permissions granted to the webview
  src/main.rs             App setup; the full list of IPC commands
  src/artifact_installer.rs  Install plugins/services from a manifest URL
  src/service_host.rs     Run native sidecars (JSON lines over stdio)
  src/service_trust.rs    User consent for non-bundled sidecars (OS keychain)
  src/secrets_vault.rs    AES-256-GCM secret store, key in OS keychain
  src/private_file.rs     Create files with mode 0600 from the start
  src/mcp_bridge.rs       Loopback HTTP bridge for the MCP stdio server
  src/bin/devtool-mcp-server.rs  MCP stdio server launched by MCP clients
  src/mockserver.rs       User-defined HTTP mock server, Rhai scripting
  src/dropped.rs, files.rs, checksum.rs  Read only files the user dropped
  src/netinfo.rs, ports.rs  Local interfaces and listening ports (read-only)

src/                      React/TypeScript webview
  platform/               Plugin platform: manifest, SDK, registry, installer
    sdk.ts                Permission checks + audit log for every plugin call
    manifest.ts           Manifest validation (permissions, hosts, commands)
    installer.ts          Install/update/load external plugin bundles
    secrets.ts            Frontend side of the secret vault
    guard.test.ts         Static rules over plugin code (see baseline.json)
  plugins/<id>/plugin.ts  Built-in plugin manifests (one per tool)
  components/tools/       Tool UIs
  lib/                    Shared helpers (deep links, file I/O, network…)
  design-system/          UI kit; guard.test.ts enforces design rules

design/                   Design tokens and rules (shared with the preview)
docs/plugin-sdk/          Plugin architecture and SDK reference
```

## Trust boundaries

### 1. Webview → Rust (IPC)

Everything in the webview can call any command registered in `main.rs`
and use the Tauri plugins granted in `src-tauri/capabilities/`. Each
command validates its own input; none trusts the webview:

- **File reads** (`read_file_data_url`, `hash_file`) only accept paths the
  user dragged onto the window, recorded by Rust from native drag events
  (`dropped.rs`). The fs plugin is scoped to the app data directory.
- **Sidecars** (`service_*`): the webview names the binary, Rust decides
  whether it may run (`service_host.rs`, `service_trust.rs`). Bundled
  sidecars are on a compile-time allowlist; anything else needs consent in
  a native dialog showing path and SHA-256. Decisions live in the OS
  keychain because the webview can write to app data. A changed binary has
  a new hash and is asked about again.
- **Secrets** (`secret_vault_*`): values are encrypted at rest; the key is
  in the OS keychain. Without a keychain the key falls back to a 0600 file
  next to the data (fails open, reported by `secret_vault_status` and shown
  in Settings).
- **Installer** (`artifact_installer_*`): see 3.

### 2. Plugins inside the webview

Plugins (`src/plugins/*`, and installed bundles) run in the same JS realm
as the app. `src/platform/sdk.ts` checks the manifest's permissions,
`hosts` and `commands` on every call and writes an audit entry.

This is a guard against mistakes, **not a sandbox**: code in the same realm
can reach Tauri's globals directly. `platform/guard.test.ts` keeps built-in
plugin code on the SDK (no direct `@tauri-apps` imports, no credentials in
the shared store). For installed plugins the real control is the install
step: the user reviews the manifest, and the bundle's integrity hash is
checked at install and on every load. See
[`plugin-sdk/01-architecture.md`](./plugin-sdk/01-architecture.md).

### 3. Remote artifacts

`artifact_installer.rs` fetches a manifest from an https URL, then the
plugin bundle or the sidecar binary for the host's target triple (chosen in
Rust, never by the manifest). Integrity hashes are mandatory, downloads are
size-capped, redirects from https to http are refused, and binaries are
written atomically. Deep links (`desktop-devtool-app://install?...`,
`src/lib/deepLink.ts`) only open the confirmation screen; nothing installs
without the user confirming.

### 4. Local network listeners

- **MCP bridge** (`mcp_bridge.rs`): 127.0.0.1 on a random port, bearer
  token compared in constant time. Port and token are in
  `<app_data>/mcp-bridge.json` (mode 0600 on Unix). Any local process that can read
  that file can call the tools the app has registered.
- **Mock server** (`mockserver.rs`): binds where the user chooses
  (loopback by default, `0.0.0.0` on request). Rhai scripts run with
  operation, depth, string and collection limits.

### 5. Updates and network policy

- Updates are verified against the minisign public key in
  `tauri.conf.json` (`plugins.updater`).
- CSP (`app.security.csp`) allows `blob:` scripts (needed to load installed
  plugin bundles) and inline styles.

## Findings

### Fixed in the audit refactor

- Secret key, vault and MCP discovery files were created with default
  permissions and then `chmod`ed, leaving a short window where they were
  readable by other users. They are now created with mode 0600
  (`private_file.rs`).
- Vault tests re-implemented the encryption instead of exercising it; the
  production `seal`/`open` functions are now what the tests call.
- Installer downloads followed redirects from https to http, which would
  let a network attacker replace both a manifest and its hashes.
- Dead code removed (`plugin_data.rs`, an unused `localNetworkInfo()`
  duplicate and duplicate interface declarations in `src/lib/network.ts`).
- Misplaced or stale doc comments in `artifact_installer.rs` and
  `service_host.rs` corrected; duplicated target lookup factored into
  `target_for`.

### Open

| # | Area | Finding |
|---|---|---|
| 1 | `capabilities/default.json` | The HTTP plugin allows `http://**` and `https://**`, so the specific hosts listed next to them are redundant and the Tauri layer does not restrict outbound HTTP. Per-plugin `hosts` are enforced only in `sdk.ts`, inside the webview (see boundary 2). |
| 2 | `platform/sdk.ts` | `commands` allowlist entries match by prefix (`mcp_`, `mock_`), so a new command with that prefix is granted implicitly. |
| 3 | `platform/sdk.ts` | `native.listen` requires the `native` permission but has no event allowlist. |
| 4 | `platform/installer.ts` | `compareVersions` treats pre-release versions (`1.2.0-beta`) as `NaN`, so they are never offered as updates. |
| 5 | `secrets_vault.rs` | The no-keychain fallback stores the key next to the data (by design, documented and visible in Settings). |
| 6 | Rust lints | `cargo clippy` reports pre-existing warnings: child processes not waited on (`bin/devtool-mcp-server.rs`, `tests/service_echo.rs`), a large enum variant in `artifact_installer.rs`. |
| 7 | Language | Code comments are English; user-facing strings are localized (vi/en). Some Rust error messages and many test titles are still in Vietnamese. |
