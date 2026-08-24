# Security

DevTool is an offline-first desktop app. This document states what the app is
allowed to do, what it never does, how to report a vulnerability, and — most
importantly — **how you can verify all of it yourself instead of trusting this
page**.

> Short version: every release binary is built in public by GitHub Actions from
> a tagged commit, signed, checksummed, and carries a cryptographic
> [build provenance attestation](#1-verify-the-binary-you-downloaded). Nothing
> is built on a maintainer's laptop.

---

## Reporting a vulnerability

Please **do not** open a public issue for a security bug.

- Use GitHub's private reporting: **Security → Report a vulnerability** on
  <https://github.com/DianaSensei/developer-desktop-utils/security/advisories/new>
- Include: version, OS, reproduction steps, and impact.
- Expect an acknowledgement within 7 days and a fix or mitigation plan within
  30 days for confirmed issues.

Supported versions: the latest released version only.

---

## Threat model

**What DevTool is:** a local toolbox. Data you paste in is processed in your own
process, on your own machine.

| Claim | Enforced by | How you check it |
|---|---|---|
| No telemetry, no analytics, no crash reporting | There is no such code and no such dependency | `grep -ri "analytics\|telemetry\|sentry\|posthog\|mixpanel\|amplitude" src/ src-tauri/src/` → the only hit is the UI copy in `src/lib/i18n.ts` that says so |
| No account, no login, no server owned by us | No auth code; the only fixed endpoint is the GitHub release feed | `grep -rn "endpoints" src-tauri/tauri.conf.json` |
| Data stays local | Local files + OS keychain-free `store` plugin, written under the OS app-data dir | `fs:scope-appdata-recursive` in `src-tauri/capabilities/default.json` |
| Network calls only happen when you press a button | The tools that reach the network are marked 🌐 in the README; none run on startup | Watch it: [network verification](#4-watch-what-it-actually-does-on-the-wire) |
| Updates cannot be spoofed | Updater artifacts are minisign-signed; the public key is compiled into the app | `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; the private key exists only as a GitHub Actions secret |

**What DevTool is not:** a sandbox for hostile input, and not a security boundary
between you and content you choose to load. See
[Known scopes and honest limitations](#known-scopes-and-honest-limitations).

---

## The security controls, and where they live in the repo

### Build and supply chain

- **Reproducible origin.** Releases are produced only by
  [`.github/workflows/release.yml`](.github/workflows/release.yml), triggered by a
  `v*` tag push, running on GitHub-hosted runners. No maintainer machine touches
  the artifacts.
- **Build provenance attestation** (SLSA-style, signed via Sigstore) is generated
  for every published artifact, binding it to the exact repo, commit, workflow
  and runner that produced it.
- **SHA256SUMS** are published with each release, per platform.
- **SBOM** (SPDX) is published with each release, covering both the npm and the
  Cargo dependency trees.
- **Every GitHub Action is pinned to a commit SHA**, not a mutable tag. A tag
  like `@v4` can be repointed by whoever controls the action's repository — as
  happened to `tj-actions/changed-files` in March 2025 — which would run their
  code inside the release job, next to the updater signing key. Pinned SHAs
  cannot be swapped; Dependabot proposes upgrades as reviewable PRs.
- **Updater signing** uses a minisign keypair; the private half lives only in
  `secrets.TAURI_SIGNING_PRIVATE_KEY`. The app refuses an update whose signature
  does not verify against the embedded public key.

### Continuous scanning

[`.github/workflows/security.yml`](.github/workflows/security.yml) runs on every
push to `main`, every pull request, and weekly:

| Check | Tool | Covers |
|---|---|---|
| Known-vulnerable npm packages | `npm audit` | frontend dependency tree |
| Known-vulnerable Rust crates | `cargo audit` (RustSec) | backend dependency tree; unmaintained/unsound notices are reported, vulnerabilities block |
| Code vulnerabilities (taint analysis) | GitHub CodeQL (default setup, configured in repo settings) | TypeScript/JavaScript, Rust, Actions |
| Leaked secrets/keys in history | TruffleHog (verified secrets only) | whole repo, full history on schedule |
| Risky new dependencies in a PR | `dependency-review-action` | the PR diff |

Dependency updates arrive as reviewable PRs via
[`.github/dependabot.yml`](.github/dependabot.yml) (npm, Cargo, GitHub Actions).

### Runtime hardening

- **Content Security Policy** (`app.security.csp` in `src-tauri/tauri.conf.json`):
  `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`. No remote script can be injected into the app shell.
- **Tauri 2 capability allowlist**
  (`src-tauri/capabilities/default.json`): the webview can only call the
  permissions listed there. Anything absent — arbitrary shell execution, for
  instance — is not reachable from the frontend at all. Note there is **no**
  `shell` plugin and **no** `shell:allow-execute` in this app.
- **Filesystem scope** is limited to the app-data directory plus files you
  explicitly pick through the OS open/save dialog.
- **Memory-safe backend.** The Rust side has no `unsafe` blocks in app code
  (`grep -rn "unsafe" src-tauri/src/`).

---

## How to verify this yourself

### 1. Verify the binary you downloaded

Every release artifact carries a Sigstore-backed provenance attestation. With the
[GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify ./DevTool_1.0.0_aarch64.dmg \
  --repo DianaSensei/developer-desktop-utils
```

A pass means: this exact file was produced by this repo's release workflow, from
a specific commit — not repacked, not rebuilt by a third party, not modified
after the fact. A fail means **do not run it**.

Then check the hash against the published `SHA256SUMS-*.txt`:

```bash
shasum -a 256 -c SHA256SUMS-macos-latest-aarch64-apple-darwin.txt   # macOS / Linux
certutil -hashfile DevTool_1.0.0_x64_en-US.msi SHA256   # Windows
```

Or run the bundled helper, which does both:

```bash
./scripts/verify-release.sh v1.0.0
```

### 2. Read the whole attack surface — it is small

The privileged surface is exactly the Rust commands and the capability file:

```bash
grep -rn "#\[tauri::command\]" src-tauri/src/     # 92 callable backend functions, all listed here
cat src-tauri/capabilities/default.json           # every permission the UI holds
```

There is no dynamic code loading in the Rust backend and no plugin system that
pulls code from the network.

### 3. Build it yourself and compare

```bash
git clone https://github.com/DianaSensei/developer-desktop-utils
cd developer-desktop-utils && git checkout v1.0.0
npm ci && npm run tauri:build
```

Byte-for-byte reproducibility is **not** claimed (Rust/Tauri bundling embeds
timestamps and paths), but a self-built binary is the strongest option if you do
not want to trust our CI at all — and it is the same source the attestation
points to.

### 4. Watch what it actually does on the wire

Run the app with a proxy or packet capture and confirm it is idle until you ask
for something:

```bash
# macOS/Linux
sudo tcpdump -i any -n 'tcp and not port 22'
# or point it at mitmproxy / Proxyman / Fiddler and inspect every request
```

Expected traffic: **nothing at rest**, except an update check against
`github.com` if auto-update is enabled (Settings → Updates → off to stop even
that). Everything else only fires from a tool you invoked.

### 5. Check the repo's own security posture

- **OpenSSF Scorecard** grades this repo automatically every week — the badge in
  the README links to the full breakdown at
  <https://scorecard.dev/viewer/?uri=github.com/DianaSensei/developer-desktop-utils>.
  It is scored by the OpenSSF, not by us.
- **Snyk's public report** for this repository:
  <https://snyk.io/test/github/DianaSensei/developer-desktop-utils>
- Actions runs are public: <https://github.com/DianaSensei/developer-desktop-utils/actions>
- The security workflow's results are visible in the Actions log and in the
  repository's Security tab (CodeQL alerts).

---

## Known scopes and honest limitations

We would rather write these down than have you find them.

1. **The HTTP capability is broad.** `src-tauri/capabilities/default.json` allows
   `http://**` and `https://**`. This is inherent to the **API Client** tool: an
   HTTP workbench must be able to call any host you type. It means the webview
   can issue arbitrary outbound HTTP requests. The mitigation is the CSP (no
   remote code can get into the webview to abuse it) plus the fact that requests
   are user-initiated.
2. **API Client scripts are not sandboxed.** Pre/post-request scripts run through
   the `AsyncFunction` constructor in the app's own JS context
   (`src/components/tools/apiclient/runtime.ts`). This is the same trust model as
   Postman and Bruno: the scripts are *your* scripts. **Do not paste or import a
   collection containing scripts you have not read** — treat a `.bru`/Postman
   collection from a stranger like an executable.
3. **macOS builds are ad-hoc signed, not notarized.** `signingIdentity: "-"` —
   we do not yet have an Apple Developer certificate, which is why Gatekeeper
   complains and `xattr -cr` is needed. Verify the attestation (step 1) before
   you clear the quarantine flag. Windows builds are likewise not
   Authenticode-signed, so SmartScreen may warn.
4. **Third-party services you point tools at** (DNS-over-HTTPS resolvers, IP
   geolocation, your Kafka/RabbitMQ/Redis/Docker endpoints) see the queries you
   send them. That is the tool doing its job, not the app phoning home.
5. **Credentials you enter** (broker passwords, API tokens) are stored by the
   Tauri `store` plugin as files under the OS app-data directory, not in an OS
   keychain, and not encrypted at rest. Anyone with your user account can read
   them. Treat that like a `.env` file.

---

## License

MIT — see [LICENSE](LICENSE). The code is fully readable; nothing is minified,
obfuscated, or shipped as a prebuilt blob.
