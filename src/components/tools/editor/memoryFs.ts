// In-memory stand-in for the Rust backend, used by the browser build and the
// tests. Same contract as editor_fs.rs: paths outside an opened folder are
// `denied`, nothing is overwritten implicitly, a workspace folder cannot be
// renamed or deleted from inside, and a stale save is a `conflict`.

import {
  EditorFsError, type DirEntry, type EditorFs, type FileContent, type FileList, type FileStat,
} from './fs';
import { basename, dirname, isUnder, join, relativeTo } from './paths';

type Node =
  | { kind: 'file'; content: string; modified: number }
  | { kind: 'dir'; modified: number };

export const DEMO_ROOT = '/demo-workspace';

const DEMO_FILES: Record<string, string> = {
  'README.md': '# Demo workspace\n\nThis folder lives in memory: the browser build cannot reach your disk.\nOpen DevTool\'s desktop app to edit real files.\n\n- Explorer: right-click for New File, Rename, Delete…\n- ⌘/Ctrl+P: Quick Open\n- ⌘/Ctrl+S: Save\n',
  'package.json': '{\n  "name": "demo",\n  "version": "1.0.0",\n  "scripts": {\n    "start": "node src/index.js"\n  }\n}\n',
  'src/index.js': "import { greet } from './utils/greet.js';\n\nconsole.log(greet('world'));\n",
  'src/utils/greet.js': 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
  'src/styles.css': 'body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}\n',
  'scripts/build.py': 'import sys\n\n\ndef main() -> int:\n    print("building", sys.argv[1:])\n    return 0\n\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n',
};

const MAX_WALK = 20_000;
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'target', '__pycache__', '.venv', '.next', '.turbo']);

function checkComponent(name: string) {
  if (!name.trim()) throw new EditorFsError('invalid_name', 'A name is required.');
  if (name === '.' || name === '..') throw new EditorFsError('invalid_name', '"." and ".." are not valid names.');
  if (/[\\/\0]/.test(name)) throw new EditorFsError('invalid_name', 'A name cannot contain / or \\.');
  if (name.length > 255) throw new EditorFsError('invalid_name', 'That name is too long.');
}

export interface MemoryFsOptions {
  /** Files (root-relative path → content) to seed `DEMO_ROOT` with. */
  files?: Record<string, string>;
  /** Folder `pickFolder()` "chooses". Defaults to `DEMO_ROOT`. */
  pickResult?: string | null;
  /** Folders authorised from the start (as if picked in an earlier session). */
  authorised?: string[];
  /** Clock, for deterministic mtimes in tests. */
  now?: () => number;
}

export interface MemoryFs extends EditorFs {
  /** Test hook: change a file behind the editor's back. */
  touch(path: string, content: string): void;
  has(path: string): boolean;
}

export function createMemoryFs(opts: MemoryFsOptions = {}): MemoryFs {
  let tick = 0;
  const now = opts.now ?? (() => Date.now() + tick++);
  const nodes = new Map<string, Node>();
  const roots: string[] = [...(opts.authorised ?? [])];

  const mkdirp = (dir: string) => {
    if (nodes.has(dir)) return;
    if (dir !== '/') mkdirp(dirname(dir));
    nodes.set(dir, { kind: 'dir', modified: now() });
  };
  const seed = opts.files ?? DEMO_FILES;
  mkdirp(DEMO_ROOT);
  for (const [rel, content] of Object.entries(seed)) {
    const path = join(DEMO_ROOT, rel);
    mkdirp(dirname(path));
    nodes.set(path, { kind: 'file', content, modified: now() });
  }

  const within = (p: string) => roots.some((r) => isUnder(p, r));
  const resolve = (p: string): Node => {
    const node = nodes.get(p);
    if (!node) throw new EditorFsError(within(p) ? 'not_found' : 'denied', `No such file: ${p}`);
    if (!within(p)) throw new EditorFsError('denied', 'That path is outside the folders opened in the editor.');
    return node;
  };
  const resolveEntry = (p: string): Node => {
    if (roots.includes(p)) throw new EditorFsError('root', 'A workspace folder cannot be changed from inside itself.');
    return resolve(p);
  };
  const resolveDir = (p: string) => {
    if (resolve(p).kind !== 'dir') throw new EditorFsError('not_dir', 'Not a folder.');
  };
  const children = (dir: string) => [...nodes.keys()].filter((k) => k !== dir && dirname(k) === dir);
  const stat = (n: Node): FileStat => ({
    size: n.kind === 'file' ? new TextEncoder().encode(n.content).length : 0,
    modified: n.modified,
    isDir: n.kind === 'dir',
  });
  const moveTree = (from: string, to: string) => {
    for (const key of [...nodes.keys()]) {
      if (isUnder(key, from)) {
        const node = nodes.get(key)!;
        nodes.delete(key);
        nodes.set(to + key.slice(from.length), node);
      }
    }
  };

  const create = async (dir: string, name: string, folder: boolean) => {
    resolveDir(dir);
    const parts = name.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) throw new EditorFsError('invalid_name', 'A name is required.');
    parts.forEach(checkComponent);
    let parent = dir;
    for (const part of parts.slice(0, -1)) {
      const next = join(parent, part);
      const existing = nodes.get(next);
      if (existing && existing.kind !== 'dir') throw new EditorFsError('not_dir', `"${part}" is a file, not a folder.`);
      if (!existing) nodes.set(next, { kind: 'dir', modified: now() });
      parent = next;
    }
    const target = join(parent, parts[parts.length - 1]);
    if (nodes.has(target)) throw new EditorFsError('exists', `"${parts.join('/')}" already exists.`);
    nodes.set(target, folder ? { kind: 'dir', modified: now() } : { kind: 'file', content: '', modified: now() });
    return target;
  };

  return {
    kind: 'memory',
    async pickFolder() {
      const picked = opts.pickResult === undefined ? DEMO_ROOT : opts.pickResult;
      if (!picked) return null;
      if (nodes.get(picked)?.kind !== 'dir') throw new EditorFsError('not_dir', 'Only folders can be opened.');
      const i = roots.indexOf(picked);
      if (i >= 0) roots.splice(i, 1);
      roots.push(picked);
      return picked;
    },
    async roots() { return roots.filter((r) => nodes.has(r)); },
    async forgetRoot(path) {
      const i = roots.indexOf(path);
      if (i >= 0) roots.splice(i, 1);
    },
    async listDir(path) {
      resolveDir(path);
      const entries: DirEntry[] = children(path).map((p) => {
        const n = nodes.get(p)!;
        return { name: basename(p), path: p, isDir: n.kind === 'dir', isSymlink: false, size: stat(n).size, modified: n.modified };
      });
      entries.sort((a, b) => Number(b.isDir) - Number(a.isDir)
        || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        || a.name.localeCompare(b.name));
      return { entries, truncated: false };
    },
    async listFiles(root, limit = MAX_WALK) {
      resolveDir(root);
      const cap = Math.min(limit, MAX_WALK);
      const files: FileList['files'] = [];
      let truncated = false;
      const keys = [...nodes.keys()].filter((k) => k !== root && isUnder(k, root)).sort();
      for (const k of keys) {
        const n = nodes.get(k)!;
        if (n.kind !== 'file') continue;
        const rel = relativeTo(k, root);
        if (rel.split('/').slice(0, -1).some((seg) => SKIP_DIRS.has(seg))) continue;
        if (files.length >= cap) { truncated = true; break; }
        files.push({ path: k, rel });
      }
      return { files, truncated };
    },
    async stat(path) { return stat(resolve(path)); },
    async readFile(path): Promise<FileContent> {
      const n = resolve(path);
      if (n.kind !== 'file') throw new EditorFsError('is_dir', 'That is a folder.');
      const binary = n.content.includes('\0');
      return { content: binary ? '' : n.content, binary, bom: false, size: n.content.length, modified: n.modified };
    },
    async writeFile(path, content, wopts = {}) {
      const n = resolve(path);
      if (n.kind !== 'file') throw new EditorFsError('is_dir', 'That is a folder.');
      if (wopts.expectedModified && n.modified !== wopts.expectedModified) {
        throw new EditorFsError('conflict', 'The file was changed on disk after it was opened.');
      }
      const next: Node = { kind: 'file', content, modified: Math.max(now(), n.modified + 1) };
      nodes.set(path, next);
      return stat(next);
    },
    createFile: (dir, name) => create(dir, name, false),
    createDir: (dir, name) => create(dir, name, true),
    async rename(path, newName) {
      checkComponent(newName);
      resolveEntry(path);
      const dst = join(dirname(path), newName);
      if (dst === path) return path;
      if (nodes.has(dst)) throw new EditorFsError('exists', `"${newName}" already exists.`);
      moveTree(path, dst);
      return dst;
    },
    async move(path, targetDir) {
      resolveEntry(path);
      resolveDir(targetDir);
      if (isUnder(targetDir, path)) throw new EditorFsError('invalid_move', 'A folder cannot be moved into itself.');
      const dst = join(targetDir, basename(path));
      if (dst === path) return path;
      if (nodes.has(dst)) throw new EditorFsError('exists', `"${basename(path)}" already exists in the destination folder.`);
      moveTree(path, dst);
      return dst;
    },
    async delete(path) {
      resolveEntry(path);
      for (const key of [...nodes.keys()]) if (isUnder(key, path)) nodes.delete(key);
    },
    touch(path, content) {
      if (!nodes.has(dirname(path))) mkdirp(dirname(path));
      const prev = nodes.get(path);
      nodes.set(path, { kind: 'file', content, modified: Math.max(now(), (prev?.modified ?? 0) + 1) });
    },
    has: (path) => nodes.has(path),
  };
}
