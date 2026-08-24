#!/usr/bin/env bash
# Turns the promises in SECURITY.md into assertions, so they cannot rot silently.
# Run locally (./scripts/check-security-claims.sh) or in CI (.github/workflows/security.yml).
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else bad "$desc"; fi
}

not() { ! "$@"; }

echo "Verifying the claims in SECURITY.md"
echo

# ── No unsafe Rust in application code ──────────────────────────────────────
if grep -rn '\bunsafe\b' src-tauri/src/ >/dev/null 2>&1; then
  bad "src-tauri/src contains no 'unsafe' blocks"
  grep -rn '\bunsafe\b' src-tauri/src/ | sed 's/^/        /'
else
  pass "src-tauri/src contains no 'unsafe' blocks"
fi

# ── No shell-execution capability reachable from the webview ────────────────
check "no tauri shell plugin in Cargo.toml" \
  not grep -q 'tauri-plugin-shell' src-tauri/Cargo.toml
check "no shell:* permission granted to the webview" \
  not grep -q '"shell:' src-tauri/capabilities/default.json

# ── No telemetry / analytics dependency ─────────────────────────────────────
for dep in sentry posthog mixpanel amplitude segment google-analytics; do
  check "no '$dep' dependency (npm)"   not grep -qi "\"[^\"]*$dep[^\"]*\": *\"" package.json
  check "no '$dep' dependency (cargo)" not grep -qi "^$dep" src-tauri/Cargo.toml
done

# ── Content Security Policy is present and restrictive ──────────────────────
conf=src-tauri/tauri.conf.json
for directive in "default-src 'self'" "object-src 'none'" "base-uri 'self'" "frame-ancestors 'none'"; do
  check "CSP contains \"$directive\"" grep -qF "$directive" "$conf"
done
check "no dangerousRemoteDomainIpcAccess" \
  not grep -q 'dangerousRemoteDomainIpcAccess' "$conf"
check "no dangerousUseHttpScheme" \
  not grep -q 'dangerousUseHttpScheme' "$conf"

# ── Updater is signed and points only at this repo's releases ───────────────
check "updater public key is embedded" grep -q '"pubkey"' "$conf"
check "updater endpoint is this repo's GitHub releases" \
  grep -q 'https://github.com/DianaSensei/developer-desktop-utils/releases' "$conf"
if node -e '
      const c = require("./src-tauri/tauri.conf.json");
      const eps = (c.plugins?.updater?.endpoints) ?? [];
      if (!eps.length) process.exit(1);
      const bad = eps.filter((u) => !u.startsWith("https://github.com/DianaSensei/developer-desktop-utils/"));
      if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
    '; then
  pass "every updater endpoint points at this repo over HTTPS"
else
  bad "every updater endpoint points at this repo over HTTPS"
fi

# ── Filesystem access stays inside the app-data dir (plus dialog picks) ─────
check "fs scope is limited to appdata" \
  grep -q 'fs:scope-appdata-recursive' src-tauri/capabilities/default.json
check "no fs:scope-home / fs:scope-document grants" \
  not grep -qE '"fs:scope-(home|document|desktop|download)' src-tauri/capabilities/default.json

# ── No secrets committed to the tree ────────────────────────────────────────
if grep -rn -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' --exclude-dir=.git --exclude-dir=node_modules . >/dev/null 2>&1; then
  bad "no private key material in the repository"
else
  pass "no private key material in the repository"
fi

# ── Every GitHub Action is pinned to an immutable commit SHA ────────────────
# A tag like @v4 can be repointed by whoever owns the action, which would run
# their new code inside the release job — next to the updater signing key.
unpinned="$(grep -rhn 'uses: .*@' .github/workflows/ | grep -vE '@[0-9a-f]{40}' || true)"
if [ -n "$unpinned" ]; then
  bad "every action in .github/workflows is pinned to a commit SHA"
  printf '        %s\n' "$unpinned"
else
  pass "every action in .github/workflows is pinned to a commit SHA"
fi

# ── The release pipeline still produces verifiable output ───────────────────
rel=.github/workflows/release.yml
check "release workflow emits build provenance attestations" \
  grep -q 'attest-build-provenance' "$rel"
check "release workflow publishes SHA256SUMS" \
  grep -q 'SHA256SUMS' "$rel"
check "release workflow publishes an SBOM" \
  grep -qi 'sbom' "$rel"

echo
if [ "$fail" -ne 0 ]; then
  echo "One or more security claims no longer hold — fix the code or update SECURITY.md."
  exit 1
fi
echo "All documented security claims hold."
