// Builds latest.json (the Tauri updater manifest) after every platform's
// bundle has already been built, signed, downloaded, and uploaded as
// release assets — see .github/workflows/release.yml's `publish` job.
//
// tauri-action used to generate this file itself, incrementally, as each
// platform's job finished. Splitting build from publish means no single
// step still has that full picture handed to it, so this reconstructs the
// same file from what's on disk (downloaded/bundle-<platform>/*) and what
// GitHub Releases assigned each uploaded asset (asset id -> API url).
//
// Schema, key names, and the "which format is signed / which format also
// gets the short <os>-<arch> alias" rules below are copied from a REAL
// tauri-action-generated latest.json (v0.9.0's — the last release built by
// the old combined build+publish step), not guessed. Getting this wrong
// breaks auto-update silently for every user, so:
//   - dmg is NOT signed (no .sig sibling) and gets NO manifest entry at all.
//   - app.tar.gz (macOS), AppImage (Linux), and nsis .exe (Windows) are each
//     that platform's "primary" updater format: they get both the bare
//     "<os>-<arch>" key AND a "<os>-<arch>-<format>" alias.
//   - deb is signed but is NOT primary: it gets only "<os>-<arch>-deb", no
//     bare "linux-x86_64" duplicate (AppImage already owns that key).
import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const RELEASE_TAG = process.env.RELEASE_TAG;
const RELEASE_NOTES = process.env.RELEASE_NOTES;
const REPO = process.env.GITHUB_REPOSITORY;
if (!RELEASE_TAG || !REPO) throw new Error('RELEASE_TAG and GITHUB_REPOSITORY env vars are required');

// Resolve to an absolute path ourselves instead of letting execFileSync hand
// a bare command name to the OS for PATH lookup (SonarCloud javascript:S4036
// — "make sure the PATH variable only contains fixed, unwriteable
// directories"; a bare name trusts every directory on PATH equally, whereas
// this only trusts whichever one actually has an executable named `gh`).
function resolveExecutable(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`\`${name}\` not found on PATH`);
}

const GH = resolveExecutable('gh');

const version = RELEASE_TAG.replace(/^v/, '');

// Maps this workflow's `matrix.platform` (the directory each
// actions/upload-artifact name="bundle-${{ matrix.platform }}" download
// lands in) to the updater's platform-arch key. Keep in sync with
// release.yml's build job matrix.
const PLATFORM_TO_OS_ARCH = {
  'bundle-ubuntu-22.04': 'linux-x86_64',
  'bundle-macos-latest': 'darwin-aarch64',
  'bundle-windows-latest': 'windows-x86_64',
};

// extension -> { format, primary } — primary formats also get the bare
// "<os>-<arch>" key; dmg is intentionally absent (unsigned, no entry).
const FORMAT_RULES = [
  { ext: '.app.tar.gz', format: 'app', primary: true },
  { ext: '.AppImage', format: 'appimage', primary: true },
  { ext: '.deb', format: 'deb', primary: false },
  { ext: '.exe', format: 'nsis', primary: true },
];

function classify(filename) {
  for (const rule of FORMAT_RULES) {
    if (filename.endsWith(rule.ext)) return rule;
  }
  return null;
}

// Asset URLs come from the GitHub REST API response for this release (the
// exact `https://api.github.com/repos/OWNER/REPO/releases/assets/<id>` form
// tauri-action itself used — confirmed against v0.9.0's real latest.json),
// not built by hand from the filename.
const releaseJson = execFileSync(GH, ['api', `repos/${REPO}/releases/tags/${RELEASE_TAG}`], {
  encoding: 'utf-8',
});
const release = JSON.parse(releaseJson);
const assetUrlByName = new Map(release.assets.map((a) => [a.name, a.url]));

const platforms = {};

for (const platformDir of readdirSync('downloaded')) {
  const osArch = PLATFORM_TO_OS_ARCH[platformDir];
  if (!osArch) continue; // unknown/extra directory — ignore rather than guess

  for (const filename of readdirSync(join('downloaded', platformDir))) {
    if (filename.endsWith('.sig')) continue; // handled as a sibling below
    const rule = classify(filename);
    if (!rule) continue; // e.g. dmg — unsigned, not part of the manifest

    // The manifest's "signature" field is base64(the .sig file's raw text
    // content), NOT the file's content verbatim — confirmed by decoding a
    // real tauri-action-generated latest.json's signature field, which
    // produces the human-readable minisign block ("untrusted comment: ...").
    const sigPath = join('downloaded', platformDir, `${filename}.sig`);
    let signature;
    try {
      signature = readFileSync(sigPath).toString('base64');
    } catch {
      continue; // no .sig sibling — not an updater-signed artifact (e.g. dmg)
    }

    const url = assetUrlByName.get(filename);
    if (!url) throw new Error(`No uploaded release asset found for ${filename} — was it actually uploaded?`);

    const entry = { signature, url };
    platforms[`${osArch}-${rule.format}`] = entry;
    if (rule.primary) platforms[osArch] = entry;
  }
}

if (Object.keys(platforms).length === 0) {
  throw new Error('No signed updater artifacts found in downloaded/ — refusing to publish an empty latest.json');
}

const manifest = {
  version,
  notes: RELEASE_NOTES ?? '',
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync('latest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
