// In-memory stand-in for the Rust backend, used by the browser build and the
// tests. Same contract as editor_fs.rs: paths outside an opened folder are
// `denied`, nothing is overwritten implicitly, a workspace folder cannot be
// renamed or deleted from inside, and a stale save is a `conflict`.

import {
  EditorFsError, type BackupStore, type DirEntry, type HistoryEntry, type HistoryStore, type ViewerStore, type ViewLine, type EditorFs, type FileContent, type FileList, type FileStat,
} from './fs';
import { basename, dirname, isUnder, join, relativeTo } from './paths';
import { DEFAULT_MAX_RESULTS, GlobSet, buildRegExp, emptyResult, fileIncluded, gitignoreGlobs, searchText } from './textSearch';

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
  /** Folder Save As "chooses" (the name is the suggested one, de-duplicated). */
  saveDir?: string;
  /** Where untitled-tab backups go. Defaults to a Map (lost on reload); the
   *  browser build passes its plugin storage so the demo keeps them too. */
  backupStorage?: { get(key: string): string | null; set(key: string, value: string): void; remove?(key: string): void };
  /** Clock, for deterministic mtimes in tests. */
  now?: () => number;
}

/** Runs synchronous in-memory work as the async contract the real backend
 *  has: a value resolves, a throw rejects (never escapes synchronously). */
function run<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

const byName = (a: string, b: string) => a.localeCompare(b);

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

  const files: string[] = [];
  let searchEpoch = 0;
  const within = (p: string) => roots.some((r) => isUnder(p, r)) || files.includes(p);
  const resolve = (p: string): Node => {
    const node = nodes.get(p);
    if (!node) throw new EditorFsError(within(p) ? 'not_found' : 'denied', `No such file: ${p}`);
    if (!within(p)) throw new EditorFsError('denied', 'That path is outside the folders opened in the editor.');
    return node;
  };
  const resolveEntry = (p: string): Node => {
    if (roots.includes(p)) throw new EditorFsError('root', 'A workspace folder cannot be changed from inside itself.');
    // A file authorised on its own may be read and written, nothing more.
    if (!roots.some((r) => isUnder(p, r))) throw new EditorFsError('denied', 'That path is outside the folders opened in the editor.');
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

  const create = (dir: string, name: string, folder: boolean) => run(() => {
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
  });

  const backupMap = new Map<string, string>();
  const bs = opts.backupStorage;
  const INDEX = 'backup-index';
  const index = (): string[] => {
    if (!bs) return [...backupMap.keys()];
    try { return JSON.parse(bs.get(INDEX) ?? '[]') as string[]; } catch { return []; }
  };
  const backups: BackupStore = {
    list() { return run(() => index().sort(byName)); },
    read(key) { return run(() => { return bs ? bs.get(`backup:${key}`) : backupMap.get(key) ?? null; }); },
    write(key, content) { return run(() => {
      if (!bs) { backupMap.set(key, content); return; }
      bs.set(`backup:${key}`, content);
      const keys = index();
      if (!keys.includes(key)) bs.set(INDEX, JSON.stringify([...keys, key]));
    }); },
    delete(key) { return run(() => {
      if (!bs) { backupMap.delete(key); return; }
      if (bs.remove) bs.remove(`backup:${key}`); else bs.set(`backup:${key}`, '');
      bs.set(INDEX, JSON.stringify(index().filter((k) => k !== key)));
    }); },
  };

  // Local History, kept in memory (the browser demo has no app data folder).
  const historyMap = new Map<string, { entry: HistoryEntry; content: string }[]>();
  let historySeq = 0;
  const historyKey = (p: string) => {
    if (nodes.has(p)) { resolve(p); return p; }
    if (!within(dirname(p))) throw new EditorFsError('denied', 'That path is outside the folders opened in the editor.');
    return p; // deleted since: history stays reachable
  };
  const history: HistoryStore = {
    add(path, content, source) { return run(() => {
      const key = historyKey(path);
      const list = historyMap.get(key) ?? [];
      const last = list[list.length - 1];
      if (last && last.content === content) return null;
      const ts = now();
      const entry: HistoryEntry = { id: `${ts}-${historySeq++}`, ts, size: content.length, hash: String(content.length), source };
      list.push({ entry, content });
      while (list.length > 50) list.shift();
      historyMap.set(key, list);
      return entry;
    }); },
    list(path) { return run(() => { return [...(historyMap.get(historyKey(path)) ?? [])].reverse().map((x) => x.entry); }); },
    read(path, id) { return run(() => {
      const hit = historyMap.get(historyKey(path))?.find((x) => x.entry.id === id);
      if (!hit) throw new EditorFsError('not_found', 'No such snapshot.');
      return hit.content;
    }); },
    delete(path, id) { return run(() => {
      const key = historyKey(path);
      historyMap.set(key, (historyMap.get(key) ?? []).filter((x) => x.entry.id !== id));
    }); },
    clear(path) { return run(() => { historyMap.delete(historyKey(path)); }); },
  };

  // The large-file viewer over an in-memory file: same line, search and
  // tail semantics as editor_view.rs, without the index (it is all in RAM).
  const viewers = new Map<number, string>();
  let viewerSeq = 0;
  const viewLines = (id: number): string[] => {
    const path = viewers.get(id);
    if (path === undefined) throw new EditorFsError('not_found', 'That viewer was closed.');
    const n = nodes.get(path);
    if (n?.kind !== 'file') return [];
    const lines = n.content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  };
  const viewStatus = (id: number) => {
    const n = nodes.get(viewers.get(id) ?? '');
    const size = n?.kind === 'file' ? n.content.length : 0;
    return { size, lines: viewLines(id).length, scanned: size, done: true, binary: n?.kind === 'file' && n.content.includes('\0'), generation: 0 };
  };
  const viewer: ViewerStore = {
    open(path) {
      return run(() => {
        if (resolve(path).kind !== 'file') throw new EditorFsError('is_dir', 'That is a folder.');
        const id = ++viewerSeq;
        viewers.set(id, path);
        return { id, status: viewStatus(id) };
      });
    },
    status(id) { return run(() => viewStatus(id)); },
    lines(id, start, count) {
      return run(() => viewLines(id).slice(start, start + Math.min(count, 2000)).map((text): ViewLine => ({ text, truncated: false })));
    },
    refresh(id) { return run(() => viewStatus(id)); },
    search(id, o) {
      return run(() => {
        if (!o.query) return { hits: [], nextLine: null, partial: false };
        let re: RegExp;
        try {
          re = new RegExp(o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.caseSensitive ? '' : 'i');
        } catch (e) {
          throw new EditorFsError('invalid_regex', (e as Error).message);
        }
        const lines = viewLines(id);
        const hits = [];
        const max = o.maxHits ?? 200;
        for (let i = o.fromLine; i < lines.length; i++) {
          const m = re.exec(lines[i]);
          if (!m) continue;
          hits.push({ line: i, column: m.index, lineColumn: m.index, length: m[0].length, preview: lines[i] });
          if (hits.length >= max) return { hits, nextLine: i + 1, partial: true };
        }
        return { hits, nextLine: null, partial: false };
      });
    },
    close(id) { return run(() => { viewers.delete(id); }); },
  };

  return {
    kind: 'memory',
    backups,
    history,
    viewer,
    pickFolder() { return run(() => {
      const picked = opts.pickResult === undefined ? DEMO_ROOT : opts.pickResult;
      if (!picked) return null;
      if (nodes.get(picked)?.kind !== 'dir') throw new EditorFsError('not_dir', 'Only folders can be opened.');
      const i = roots.indexOf(picked);
      if (i >= 0) roots.splice(i, 1);
      roots.push(picked);
      return picked;
    }); },
    roots() { return run(() => { return roots.filter((r) => nodes.has(r)); }); },
    authorisedFiles() { return run(() => { return files.filter((f) => nodes.has(f)); }); },
    pickFile() { return run(() => { return null; }); },
    saveAs(content, suggestedName) { return run(() => {
      const dir = opts.saveDir ?? DEMO_ROOT;
      mkdirp(dir);
      const dot = suggestedName.lastIndexOf('.');
      const stem = dot > 0 ? suggestedName.slice(0, dot) : suggestedName;
      const ext = dot > 0 ? suggestedName.slice(dot) : '';
      let path = join(dir, suggestedName);
      for (let i = 1; nodes.has(path); i++) path = join(dir, `${stem}-${i}${ext}`);
      nodes.set(path, { kind: 'file', content, modified: now() });
      if (!roots.some((r) => isUnder(path, r))) files.push(path);
      return path;
    }); },
    forgetRoot(path) { return run(() => {
      const i = roots.indexOf(path);
      if (i >= 0) roots.splice(i, 1);
    }); },
    listDir(path) { return run(() => {
      resolveDir(path);
      const entries: DirEntry[] = children(path).map((p) => {
        const n = nodes.get(p)!;
        return { name: basename(p), path: p, isDir: n.kind === 'dir', isSymlink: false, size: stat(n).size, modified: n.modified };
      });
      entries.sort((a, b) => Number(b.isDir) - Number(a.isDir)
        || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        || a.name.localeCompare(b.name));
      return { entries, truncated: false };
    }); },
    listFiles(root, limit = MAX_WALK) { return run(() => {
      resolveDir(root);
      const cap = Math.min(limit, MAX_WALK);
      const files: FileList['files'] = [];
      let truncated = false;
      const keys = [...nodes.keys()].filter((k) => k !== root && isUnder(k, root)).sort(byName);
      for (const k of keys) {
        const n = nodes.get(k)!;
        if (n.kind !== 'file') continue;
        const rel = relativeTo(k, root);
        if (rel.split('/').slice(0, -1).some((seg) => SKIP_DIRS.has(seg))) continue;
        if (files.length >= cap) { truncated = true; break; }
        files.push({ path: k, rel });
      }
      return { files, truncated };
    }); },
    searchText(q) { return run(() => {
      const started = Date.now();
      const epoch = ++searchEpoch;
      const result = emptyResult();
      const re = buildRegExp(q);
      if (!re) return result;
      const include = new GlobSet(q.include);
      const exclude = new GlobSet(q.exclude);
      const limit = Math.min(Math.max(1, q.maxResults ?? DEFAULT_MAX_RESULTS), 50_000);
      const wanted = q.roots?.length ? q.roots : roots;
      for (const root of wanted) {
        if (!roots.includes(root)) throw new EditorFsError('denied', 'Only opened folders can be searched.');
      }
      for (const root of wanted) {
        const gi = nodes.get(join(root, '.gitignore'));
        const ignore = q.useIgnoreFiles && gi?.kind === 'file' ? gitignoreGlobs(gi.content) : undefined;
        const keys = [...nodes.keys()].filter((k) => k !== root && isUnder(k, root)).sort(byName);
        for (const k of keys) {
          const n = nodes.get(k)!;
          if (n.kind !== 'file') continue;
          const rel = relativeTo(k, root);
          if (rel.split('/').slice(0, -1).some((seg) => SKIP_DIRS.has(seg))) continue;
          if (!fileIncluded(rel, include, exclude, ignore)) continue;
          if (epoch !== searchEpoch) return { ...result, cancelled: true };
          result.filesSearched++;
          if (n.content.includes('\0')) continue;
          const matches = searchText(n.content, re, limit - result.matchCount);
          if (!matches.length) continue;
          result.matchCount += matches.length;
          result.files.push({ path: k, root, rel, matches });
          if (result.matchCount >= limit) return { ...result, truncated: true, elapsedMs: Date.now() - started };
        }
      }
      return { ...result, elapsedMs: Date.now() - started };
    }); },
    cancelSearch() { searchEpoch++; return Promise.resolve(); },
    stat(path) { return run(() => { return stat(resolve(path)); }); },
    readFile(path): Promise<FileContent> { return run(() => {
      const n = resolve(path);
      if (n.kind !== 'file') throw new EditorFsError('is_dir', 'That is a folder.');
      const binary = n.content.includes('\0');
      return { content: binary ? '' : n.content, binary, bom: false, size: n.content.length, modified: n.modified };
    }); },
    writeFile(path, content, wopts = {}) { return run(() => {
      const n = resolve(path);
      if (n.kind !== 'file') throw new EditorFsError('is_dir', 'That is a folder.');
      if (wopts.expectedModified && n.modified !== wopts.expectedModified) {
        throw new EditorFsError('conflict', 'The file was changed on disk after it was opened.');
      }
      const next: Node = { kind: 'file', content, modified: Math.max(now(), n.modified + 1) };
      nodes.set(path, next);
      return stat(next);
    }); },
    createFile: (dir, name) => create(dir, name, false),
    createDir: (dir, name) => create(dir, name, true),
    rename(path, newName) { return run(() => {
      checkComponent(newName);
      resolveEntry(path);
      const dst = join(dirname(path), newName);
      if (dst === path) return path;
      if (nodes.has(dst)) throw new EditorFsError('exists', `"${newName}" already exists.`);
      moveTree(path, dst);
      return dst;
    }); },
    move(path, targetDir) { return run(() => {
      resolveEntry(path);
      resolveDir(targetDir);
      if (isUnder(targetDir, path)) throw new EditorFsError('invalid_move', 'A folder cannot be moved into itself.');
      const dst = join(targetDir, basename(path));
      if (dst === path) return path;
      if (nodes.has(dst)) throw new EditorFsError('exists', `"${basename(path)}" already exists in the destination folder.`);
      moveTree(path, dst);
      return dst;
    }); },
    delete(path) { return run(() => {
      resolveEntry(path);
      for (const key of [...nodes.keys()]) if (isUnder(key, path)) nodes.delete(key);
    }); },
    touch(path, content) {
      if (!nodes.has(dirname(path))) mkdirp(dirname(path));
      const prev = nodes.get(path);
      nodes.set(path, { kind: 'file', content, modified: Math.max(now(), (prev?.modified ?? 0) + 1) });
    },
    has: (path) => nodes.has(path),
  };
}
