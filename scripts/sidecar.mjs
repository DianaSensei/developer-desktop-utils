// Xây một bin Rust ở chế độ release rồi copy vào src-tauri/binaries/ dưới đúng
// tên Tauri's sidecar bundling (bundle.externalBin trong tauri.conf.json) kỳ
// vọng: tên bin nối thêm target-triple hiện tại. Dùng chung bởi mọi script
// build:*-sidecar(s) — mcp-server và các sidecar tier B đều theo cùng một quy
// tắc đặt tên và vị trí.

import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, chmodSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
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

  // Bootstrap: tauri-build's build.rs checks that every `bundle.externalBin`
  // entry already exists as a file on disk, and it re-runs that check on ANY
  // `cargo build`/`cargo test` of this package whenever tauri.conf.json
  // changes — not just `tauri build`. So the very first time a NEW sidecar is
  // added to externalBin, compiling it (which is itself a `cargo build` of
  // this same package) fails before it can produce the binary this script is
  // trying to create: the resource the build script wants doesn't exist yet
  // because building it is what we're about to do.
  //
  // An empty placeholder satisfies that existence check (it doesn't validate
  // the file is a real executable — only `tauri build`'s actual bundling
  // step would care about the content), so create one when there's nothing
  // there yet. Once the real binary is compiled below, it overwrites this.
  if (!existsSync(destPath)) closeSync(openSync(destPath, 'w'));

  console.log(`Building ${binName} (release)...`);
  run('cargo', ['build', '--release', '--bin', binName], srcTauri);

  const builtPath = join(srcTauri, 'target', 'release', isWindows ? `${binName}.exe` : binName);
  if (!existsSync(builtPath)) throw new Error(`Expected build output at ${builtPath}, but it doesn't exist.`);

  copyFileSync(builtPath, destPath);
  if (!isWindows) chmodSync(destPath, 0o755);

  console.log(`Sidecar ready: ${destPath}`);
  return destPath;
}
