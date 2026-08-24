#!/usr/bin/env bash
# Verify a downloaded DevTool release binary end to end.
#
#   ./scripts/verify-release.sh v1.0.0 [file ...]
#
# With no files, it verifies every DevTool artifact in the current directory.
# Requires the GitHub CLI (https://cli.github.com) for attestation verification.
set -euo pipefail

REPO="DianaSensei/developer-desktop-utils"
TAG="${1:-}"
shift || true

if [ -z "$TAG" ]; then
  echo "usage: $0 <tag> [file ...]    e.g. $0 v1.0.0 ~/Downloads/DevTool_1.0.0_aarch64.dmg" >&2
  exit 2
fi

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  shopt -s nullglob
  files=(DevTool*.dmg DevTool*.msi DevTool*.exe DevTool*.AppImage devtool*.deb DevTool*.app.tar.gz)
  shopt -u nullglob
fi

if [ ${#files[@]} -eq 0 ]; then
  echo "No DevTool artifacts found here. Pass file paths explicitly." >&2
  exit 2
fi

echo "Repository : $REPO"
echo "Release    : $TAG"
echo "Artifacts  : ${#files[@]}"
echo

# ── 1. Provenance: was this file built by this repo's release workflow? ──────
if command -v gh >/dev/null 2>&1; then
  echo "==> Verifying build provenance (Sigstore)"
  for f in "${files[@]}"; do
    printf '  %s\n' "$f"
    gh attestation verify "$f" --repo "$REPO" || {
      echo
      echo "PROVENANCE FAILED for $f — this file was not produced by $REPO's release workflow."
      echo "Do not run it."
      exit 1
    }
  done
else
  echo "==> gh CLI not found; skipping provenance check (install https://cli.github.com)"
fi
echo

# ── 2. Checksums against the published SHA256SUMS files ─────────────────────
echo "==> Verifying SHA256 checksums"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if command -v gh >/dev/null 2>&1; then
  gh release download "$TAG" --repo "$REPO" --pattern 'SHA256SUMS*' --dir "$tmp" --clobber
else
  echo "  gh CLI not found — download the SHA256SUMS-*.txt files manually from"
  echo "  https://github.com/$REPO/releases/tag/$TAG and run 'shasum -a 256 -c' yourself."
  exit 0
fi

sha_cmd() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }

for f in "${files[@]}"; do
  actual="$(sha_cmd "$f" | awk '{print $1}')"
  base="$(basename "$f")"
  expected="$(grep -h "  $base\$\| \*$base\$" "$tmp"/SHA256SUMS* 2>/dev/null | awk '{print $1}' | head -1)"
  if [ -z "$expected" ]; then
    echo "  SKIP  $base (no published checksum for this filename)"
  elif [ "$actual" = "$expected" ]; then
    echo "  OK    $base"
  else
    echo "  FAIL  $base"
    echo "        expected $expected"
    echo "        actual   $actual"
    exit 1
  fi
done

echo
echo "All checks passed. The binaries match what $REPO's CI published for $TAG."
