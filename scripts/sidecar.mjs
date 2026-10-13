// Builds a Rust bin in release mode and copies it to src-tauri/binaries/
// under the name Tauri's sidecar bundling expects (bin name plus the host
// target triple). Shared by the build:*-sidecar(s) scripts.

import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, chmodSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
}

/// Names from `bundle.externalBin` in tauri.conf.json. tauri-build checks
/// that every one of them exists on every `cargo build`, not only the bin
/// being built, so all of them need placeholders on a clean checkout.
function allExternalBinNames(root) {
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const entries = conf.bundle?.externalBin ?? [];
  return entries.map((p) => p.replace(/^binaries\//, ''));
}

export function buildSidecar(root, binName) {
  const srcTauri = join(root, 'src-tauri');

  // `rustc -vV`'s `host:` line is the current machine's Rust target triple —
  // exactly what Tauri's sidecar resolution looks for at runtime (it appends
  // `-$TARGET_TRIPLE` to the configured externalBin name). Computed BEFORE the
  // build below, because the build needs it too (see the bootstrap comment).
  const rustcInfo = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).trim();
  const hostLine = rustcInfo.split('\n').find((l) => l.startsWith('host:'));
  if (!hostLine) throw new Error(`Could not determine host target triple from:\n${rustcInfo}`);
  const targetTriple = hostLine.slice('host:'.length).trim();
  const isWindows = targetTriple.includes('windows');

  const binariesDir = join(srcTauri, 'binaries');
  mkdirSync(binariesDir, { recursive: true });
  const destPath = join(binariesDir, `${binName}-${targetTriple}${isWindows ? '.exe' : ''}`);

  // tauri-build requires every externalBin file to exist before any cargo
  // build, including the build that produces it. Empty placeholders satisfy
  // that check and are overwritten by the real binaries.
  for (const bin of allExternalBinNames(root)) {
    const path = join(binariesDir, `${bin}-${targetTriple}${isWindows ? '.exe' : ''}`);
    if (!existsSync(path)) closeSync(openSync(path, 'w'));
  }

  console.log(`Building ${binName} (release)...`);
  run('cargo', ['build', '--release', '--bin', binName], srcTauri);

  const builtPath = join(srcTauri, 'target', 'release', isWindows ? `${binName}.exe` : binName);
  if (!existsSync(builtPath)) throw new Error(`Expected build output at ${builtPath}, but it doesn't exist.`);

  copyFileSync(builtPath, destPath);
  if (!isWindows) chmodSync(destPath, 0o755);

  console.log(`Sidecar ready: ${destPath}`);
  return destPath;
}
