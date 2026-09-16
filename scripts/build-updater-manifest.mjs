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
import { accessSync, constants, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';

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

// Tauri's own bundle output nests one subdirectory per format
// (bundle/dmg/*.dmg, bundle/macos/*.app.tar.gz, bundle/appimage/*.AppImage,
// bundle/deb/*.deb, bundle/nsis/*.exe) — confirmed the hard way when v0.9.1's
// test run found zero files with a flat readdirSync (it only saw the format
// subdirectory NAMES — "dmg", "macos", etc — which never match any
// extension). actions/upload-artifact preserves that nesting, so this has
// to walk it back down instead of assuming a flat directory.
function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

// Asset URLs come from the GitHub REST API response for this release (the
// exact `https://api.github.com/repos/OWNER/REPO/releases/assets/<id>` form
// tauri-action itself used — confirmed against v0.9.0's real latest.json),
// not built by hand from the filename.
//
// GET /releases/tags/{tag} (the obvious-looking endpoint) 404s on a DRAFT
// release — confirmed the hard way in v0.9.1-test2's run: GitHub doesn't
// create the actual git tag ref until a release is PUBLISHED, and that
// endpoint requires the tag to already exist. release.yml creates this
// release as a draft on purpose (see its "Create GitHub Release (draft)"
// step) so a failure here doesn't leave a broken published release — so
// this has to find it a different way: GET /releases lists every release
// including drafts, filtered by tag_name.
//
// Filtered with --jq (server-side, before it ever reaches Node) rather than
// piping the whole `--paginate` array through JSON.parse — confirmed the
// hard way in v0.9.1-test3's run: this repo already has 90+ releases, each
// with a full asset array, and the unfiltered response blew past
// execFileSync's default 1MB maxBuffer (ENOBUFS) well before parsing ever
// started. --jq also runs per-page under --paginate, so this filters every
// page down to (at most) the one release that matches instead of buffering
// all of them.
// `gh api` doesn't expose jq's --arg (no user-supplied variables into the
// filter), so RELEASE_TAG has to go straight into the jq string literal —
// escaped for jq's own string syntax, not shell (execFileSync passes argv
// directly, no shell involved).
const tagForJq = RELEASE_TAG.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const releaseJson = execFileSync(
  GH,
  ['api', `repos/${REPO}/releases`, '--paginate', '--jq', `.[] | select(.tag_name == "${tagForJq}")`],
  { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 20 },
).trim();
const release = releaseJson ? JSON.parse(releaseJson.split('\n')[0]) : undefined;
if (!release) throw new Error(`No release found with tag_name ${RELEASE_TAG} (checked drafts too)`);
const assetUrlByName = new Map(release.assets.map((a) => [a.name, a.url]));

const platforms = {};

for (const platformDir of readdirSync('downloaded')) {
  const osArch = PLATFORM_TO_OS_ARCH[platformDir];
  if (!osArch) continue; // unknown/extra directory — ignore rather than guess

  for (const filePath of walkFiles(join('downloaded', platformDir))) {
    const filename = basename(filePath);
    if (filename.endsWith('.sig')) continue; // handled as a sibling below
    const rule = classify(filename);
    if (!rule) continue; // e.g. dmg — unsigned, not part of the manifest

    // The manifest's "signature" field is the .sig file's raw text content
    // VERBATIM, not re-encoded — Tauri's own updater signer already writes
    // that file as base64(the minisign block), so a real tauri-action
    // manifest's "signature" string decodes ONCE to the human-readable
    // minisign block ("untrusted comment: ..."). Re-encoding it here (an
    // earlier version of this script did `readFileSync(sigPath).toString
    // ('base64')`) produces a signature field that needs TWO decodes —
    // confirmed the hard way against v0.9.1-test4's real release: the
    // in-app updater rejected it with "Invalid encoding in minisign data".
    // v0.9.0's real, working, tauri-action-built latest.json needs exactly
    // one decode — verified directly against its actual signature field.
    const sigPath = join(dirname(filePath), `${filename}.sig`);
    let signature;
    try {
      signature = readFileSync(sigPath, 'utf-8').trim();
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
