// Builds the devtool-mcp-server Rust binary (src-tauri/src/bin/devtool-mcp-server.rs)
// and copies it into src-tauri/binaries/ under the exact name Tauri's sidecar
// bundling (bundle.externalBin in tauri.conf.json) expects: the binary name
// suffixed with the current Rust target triple. Run before `tauri build` so
// the compiled app ships this binary — see package.json's "tauri:build".
//
// Not run before `tauri dev`: the sidecar is only needed by an external MCP
// client (Claude Code/Desktop) pointed at the installed app, not by the dev
// loop itself. To test it locally, run this script by hand, or use
// `cargo run --bin devtool-mcp-server` directly (see the checked-in
// .mcp.json, which does exactly that).

import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcTauri = join(root, 'src-tauri');
const binName = 'devtool-mcp-server';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

console.log(`Building ${binName} (release)...`);
run('cargo', ['build', '--release', '--bin', binName], srcTauri);

// `rustc -vV`'s `host:` line is the current machine's Rust target triple —
// exactly what Tauri's sidecar resolution looks for at runtime (it appends
// `-$TARGET_TRIPLE` to the configured externalBin name).
const rustcInfo = run('rustc', ['-vV']);
const hostLine = rustcInfo.split('\n').find((l) => l.startsWith('host:'));
if (!hostLine) throw new Error(`Could not determine host target triple from:\n${rustcInfo}`);
const targetTriple = hostLine.slice('host:'.length).trim();

const isWindows = targetTriple.includes('windows');
const builtPath = join(srcTauri, 'target', 'release', isWindows ? `${binName}.exe` : binName);
if (!existsSync(builtPath)) throw new Error(`Expected build output at ${builtPath}, but it doesn't exist.`);

const binariesDir = join(srcTauri, 'binaries');
mkdirSync(binariesDir, { recursive: true });
const destPath = join(binariesDir, `${binName}-${targetTriple}${isWindows ? '.exe' : ''}`);
copyFileSync(builtPath, destPath);
if (!isWindows) chmodSync(destPath, 0o755);

console.log(`Sidecar ready: ${destPath}`);
