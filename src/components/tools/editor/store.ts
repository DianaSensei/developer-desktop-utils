// Session store for the Text Editor. Module-scope rather than component
// state because the shell unmounts a tool when you switch away from it, and
// unsaved edits must survive that — so tabs, their CodeMirror `EditorState`s
// (which carry the per-file undo history) and the explorer tree live here,
// and the React tree only renders them.
//
// What survives an app restart goes through `sdk.storage`: the open folders,
// the open tab paths, the active tab, expanded folders, word wrap, and the
// list of untitled / recently closed tabs. Unsaved edits to *files* do not —
// the tab strip's dot is the reminder to save.
//
// Untitled tabs (⌘N) are the exception, VS Code's "hot exit": their text is
// backed up continuously to `fs.backups` (one file per tab in the app data
// folder, see editor_backup.rs), so it survives closing the app. Closing an
// untitled tab with text in it never asks — it moves to Recently closed
// (`snap.closed`), backup and all, and can be restored from there.

import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState, Text, type Extension, type StateEffect, type TransactionSpec } from '@codemirror/state';
import { codeThemeWithHighlight, smartBracketSkip } from '@/components/ui/code-theme';
import { toFsError, type EditorFsError, type DirEntry, type EditorFs, type WalkEntry } from './fs';
import { loadLanguage } from './languages';
import { basename, dirname, isUnder, rebase } from './paths';

export interface StorageLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface DirState {
  entries: DirEntry[] | null;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export type TabStatus = 'idle' | 'loading' | 'ready' | 'binary' | 'error';

export interface Tab {
  id: string;
  /** `file`: a path on disk. `untitled`: an in-app buffer (⌘N) whose `path`
   *  is the pseudo-path `untitled:<key>`, `<key>` naming its backup. */
  kind: 'file' | 'untitled';
  /** N of "Untitled-N", the name shown until the first line has text. */
  untitledNo: number | null;
  path: string;
  name: string;
  status: TabStatus;
  error: string | null;
  errorCode: string | null;
  dirty: boolean;
  saving: boolean;
  eol: '\n' | '\r\n';
  bom: boolean;
  /** mtime when last read/saved — the save's conflict check. */
  modified: number;
  size: number;
  language: string | null;
  /** Disk changed under a tab with unsaved edits (or was deleted). */
  external: null | 'changed' | 'deleted';
}

export interface Notice {
  tone: 'error' | 'info';
  text: string;
  /** FsError code (or `closedUntitled`), so the UI can show a localised sentence. */
  code?: string;
  /** Recently-closed entry the notice offers to restore. */
  restoreKey?: string;
}

/** A closed tab that can be reopened (⌘⇧T / Recently closed). Untitled
 *  entries keep their text in `fs.backups` under `key`. */
export type ClosedEntry =
  | { kind: 'untitled'; key: string; name: string; untitledNo: number; closedAt: number }
  | { kind: 'file'; key: string; path: string; name: string; closedAt: number };

export const UNTITLED_PREFIX = 'untitled:';
const MAX_CLOSED = 30;

export interface EditorSnapshot {
  hydrated: boolean;
  folders: string[];
  /** Authorised folders that are not open (the "Recent" list). */
  recent: string[];
  dirs: Record<string, DirState>;
  expanded: Record<string, true>;
  selected: string | null;
  tabs: Tab[];
  activeId: string | null;
  wrap: boolean;
  /** An entry marked with Cut, waiting for Paste on a folder. */
  cut: string | null;
  notice: Notice | null;
  /** Most recent first. */
  closed: ClosedEntry[];
}

export interface Cursor {
  line: number;
  col: number;
  selected: number;
}

export type SaveResult = 'saved' | 'conflict' | 'failed' | 'skipped' | 'cancelled';

const KEYS = {
  folders: 'folders',
  tabs: 'tabs',
  active: 'active',
  expanded: 'expanded',
  wrap: 'wrap',
  untitled: 'untitled',
  closed: 'closed',
} as const;

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.get(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

let nextId = 1;

function newKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** An untitled tab is named after its first line with text, as in VS Code. */
export function untitledTitle(doc: Text, no: number): string {
  const lines = Math.min(doc.lines, 50);
  for (let i = 1; i <= lines; i++) {
    const text = doc.line(i).text.trim();
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }
  return `Untitled-${no}`;
}

/** File name Save As suggests for an untitled tab. */
export function suggestFileName(tab: Pick<Tab, 'name' | 'kind'>): string {
  if (tab.kind !== 'untitled') return tab.name;
  const base = tab.name.replace(/…$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Untitled';
  return /\.[A-Za-z0-9]{1,8}$/.test(base) ? base : `${base}.txt`;
}

export class EditorStore {
  private snap: EditorSnapshot = {
    hydrated: false, folders: [], recent: [], dirs: {}, expanded: {}, selected: null,
    tabs: [], activeId: null, wrap: false, cut: null, notice: null, closed: [],
  };
  private listeners = new Set<() => void>();
  private cursorListeners = new Set<() => void>();
  private cursor: Cursor = { line: 1, col: 1, selected: 0 };

  /** Per-tab editor state (doc + undo history + selection). */
  private states = new Map<string, EditorState>();
  /** The text as last read/saved, for "is this tab dirty?". */
  private saved = new Map<string, Text>();
  private scroll = new Map<string, number>();
  private fileCache = new Map<string, Promise<WalkEntry[]>>();

  private view: EditorView | null = null;
  private viewTabId: string | null = null;
  private dark = false;

  readonly themeSlot = new Compartment();
  readonly langSlot = new Compartment();
  readonly wrapSlot = new Compartment();

  constructor(readonly fs: EditorFs, private storage: StorageLike) {}

  // ── subscription ────────────────────────────────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = () => this.snap;
  subscribeCursor = (fn: () => void) => {
    this.cursorListeners.add(fn);
    return () => { this.cursorListeners.delete(fn); };
  };
  getCursor = () => this.cursor;

  private set(patch: Partial<EditorSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }
  private patchTab(id: string, patch: Partial<Tab>) {
    if (!this.snap.tabs.some((t) => t.id === id)) return;
    this.set({ tabs: this.snap.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }
  private patchDir(path: string, patch: Partial<DirState>) {
    const prev = this.snap.dirs[path] ?? { entries: null, truncated: false, loading: false, error: null };
    this.set({ dirs: { ...this.snap.dirs, [path]: { ...prev, ...patch } } });
  }
  tab(id: string | null) {
    return id ? this.snap.tabs.find((t) => t.id === id) ?? null : null;
  }

  notify(text: string, tone: Notice['tone'] = 'error', code?: string, restoreKey?: string) {
    this.set({ notice: { tone, text, code, restoreKey } });
  }
  dismissNotice() {
    this.set({ notice: null });
  }
  private fail(e: unknown): EditorFsError {
    const err = toFsError(e);
    this.notify(err.message, 'error', err.code);
    return err;
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private written = new Map<string, string>();

  /** Batched: one burst of tree/tab changes becomes one write per changed
   *  key (each `sdk.storage.set` is also an audit entry). */
  private persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.flushPersist(), 250);
  }

  flushPersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const s = this.snap;
    const values: Record<string, unknown> = {
      [KEYS.folders]: s.folders,
      [KEYS.tabs]: s.tabs.map((t) => t.path),
      [KEYS.active]: this.tab(s.activeId)?.path ?? null,
      [KEYS.expanded]: Object.keys(s.expanded),
      [KEYS.wrap]: s.wrap,
      [KEYS.untitled]: s.tabs
        .filter((t) => t.kind === 'untitled')
        .map((t) => ({ key: t.path.slice(UNTITLED_PREFIX.length), no: t.untitledNo })),
      [KEYS.closed]: s.closed,
    };
    for (const [key, value] of Object.entries(values)) {
      const json = JSON.stringify(value);
      if (this.written.get(key) === json) continue;
      this.written.set(key, json);
      this.storage.set(key, json);
    }
    void this.flushBackups();
  }

  // ── untitled backups ───────────────────────────────────────────────────

  private pendingBackups = new Set<string>();
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private backupWarned = false;

  /** Debounced: a pause in typing writes the backup of each changed tab. */
  private scheduleBackup(id: string) {
    this.pendingBackups.add(id);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => void this.flushBackups(), 400);
  }

  /** Writes every pending untitled backup now. */
  async flushBackups(): Promise<void> {
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = null;
    const ids = [...this.pendingBackups];
    this.pendingBackups.clear();
    await Promise.all(ids.map(async (id) => {
      const tab = this.tab(id);
      const state = this.currentState(id);
      if (!tab || tab.kind !== 'untitled' || !state) return;
      try {
        await this.fs.backups.write(tab.path.slice(UNTITLED_PREFIX.length), state.doc.toString());
      } catch (e) {
        // Say it once per session; the tab itself keeps working.
        if (!this.backupWarned) {
          this.backupWarned = true;
          this.fail(e);
        }
      }
    }));
  }

  // ── startup ────────────────────────────────────────────────────────────

  private hydrating: Promise<void> | null = null;

  /** Restores the last session. Safe to call repeatedly. */
  hydrate(): Promise<void> {
    this.hydrating ??= this.doHydrate();
    return this.hydrating;
  }

  private async doHydrate() {
    const folders = readJson<string[]>(this.storage, KEYS.folders, []);
    const tabPaths = readJson<string[]>(this.storage, KEYS.tabs, []);
    const activePath = readJson<string | null>(this.storage, KEYS.active, null);
    const expanded = readJson<string[]>(this.storage, KEYS.expanded, []);
    const wrap = readJson<boolean>(this.storage, KEYS.wrap, false);
    const untitledMeta = readJson<{ key: string; no: number | null }[]>(this.storage, KEYS.untitled, []);
    const closedSaved = readJson<ClosedEntry[]>(this.storage, KEYS.closed, []);

    let authorised: string[] = [];
    let files: string[] = [];
    let backupKeys: string[] = [];
    try {
      [authorised, files, backupKeys] = await Promise.all([
        this.fs.roots(), this.fs.authorisedFiles(), this.fs.backups.list(),
      ]);
    } catch (e) {
      this.fail(e);
    }
    // A folder forgotten (or deleted) since is no longer reachable; drop it
    // instead of showing a tree that can only error.
    const open = folders.filter((f) => authorised.includes(f));

    // Untitled tabs come back with their text from the backups. One whose
    // backup is gone (e.g. never written because it was empty) comes back
    // empty, which is what it was.
    const untitled = new Map<string, Tab>();
    await Promise.all(untitledMeta.map(async ({ key, no }) => {
      let content = '';
      try { content = (await this.fs.backups.read(key)) ?? ''; } catch { /* empty */ }
      untitled.set(key, this.makeUntitled(key, no ?? 1, content));
    }));
    const tabs: Tab[] = [];
    for (const p of tabPaths) {
      if (p.startsWith(UNTITLED_PREFIX)) {
        const tab = untitled.get(p.slice(UNTITLED_PREFIX.length));
        if (tab) { tabs.push(tab); untitled.delete(p.slice(UNTITLED_PREFIX.length)); }
      } else if (open.some((f) => isUnder(p, f)) || files.includes(p)) {
        tabs.push(this.newTab(p));
      }
    }
    tabs.push(...untitled.values());
    const active = tabs.find((t) => t.path === activePath) ?? tabs[tabs.length - 1] ?? null;
    const closed = closedSaved.filter((c) => c.kind === 'file' || backupKeys.includes(c.key)).slice(0, MAX_CLOSED);

    // Backups nothing refers to any more (a tab discarded while the app was
    // closing, an old crash) are removed.
    const keep = new Set([
      ...tabs.filter((t) => t.kind === 'untitled').map((t) => t.path.slice(UNTITLED_PREFIX.length)),
      ...closed.filter((c) => c.kind === 'untitled').map((c) => c.key),
    ]);
    for (const key of backupKeys) if (!keep.has(key)) void this.fs.backups.delete(key).catch(() => {});
    this.set({
      hydrated: true,
      folders: open,
      recent: authorised.filter((r) => !open.includes(r)).reverse(),
      expanded: Object.fromEntries(
        [...open, ...expanded.filter((p) => open.some((f) => isUnder(p, f)))].map((p) => [p, true as const]),
      ),
      tabs,
      activeId: active?.id ?? null,
      wrap,
      closed,
    });
    this.syncView(true);
    await Promise.all(Object.keys(this.snap.expanded).map((p) => this.loadDir(p)));
    if (active) await this.ensureLoaded(active.id);
  }

  // ── folders ────────────────────────────────────────────────────────────

  async openFolder() {
    let picked: string | null;
    try {
      picked = await this.fs.pickFolder();
    } catch (e) {
      this.fail(e);
      return;
    }
    if (picked) await this.addFolder(picked);
  }

  /** Re-opens an already authorised folder (from Recent). */
  async addFolder(path: string) {
    const folders = this.snap.folders.includes(path) ? this.snap.folders : [...this.snap.folders, path];
    this.set({
      folders,
      recent: this.snap.recent.filter((r) => r !== path),
      expanded: { ...this.snap.expanded, [path]: true },
      selected: path,
    });
    this.persist();
    await this.loadDir(path);
  }

  /** Removes a folder from the workspace and closes its tabs (unsaved edits
   *  are discarded — the UI asks first). It stays in Recent. */
  closeFolder(path: string) {
    const ids = this.snap.tabs.filter((t) => isUnder(t.path, path)).map((t) => t.id);
    this.closeTabs(ids);
    this.set({
      folders: this.snap.folders.filter((f) => f !== path),
      recent: [path, ...this.snap.recent.filter((r) => r !== path)],
      expanded: Object.fromEntries(Object.entries(this.snap.expanded).filter(([p]) => !isUnder(p, path))),
      dirs: Object.fromEntries(Object.entries(this.snap.dirs).filter(([p]) => !isUnder(p, path))),
      selected: this.snap.selected && isUnder(this.snap.selected, path) ? null : this.snap.selected,
    });
    this.fileCache.delete(path);
    this.persist();
  }

  /** Drops a folder from Recent and revokes the app's access to it. */
  async forgetFolder(path: string) {
    try {
      await this.fs.forgetRoot(path);
      this.set({ recent: this.snap.recent.filter((r) => r !== path) });
    } catch (e) {
      this.fail(e);
    }
  }

  rootOf(path: string): string | null {
    return this.snap.folders.find((f) => isUnder(path, f)) ?? null;
  }

  // ── tree ───────────────────────────────────────────────────────────────

  async loadDir(path: string) {
    this.patchDir(path, { loading: true });
    try {
      const { entries, truncated } = await this.fs.listDir(path);
      this.patchDir(path, { entries, truncated, loading: false, error: null });
    } catch (e) {
      const err = toFsError(e);
      if (err.code === 'not_found') {
        // Deleted outside the editor: forget it rather than show an error row.
        const { [path]: _gone, ...rest } = this.snap.dirs;
        const { [path]: _was, ...exp } = this.snap.expanded;
        this.set({ dirs: rest, expanded: exp });
      } else {
        this.patchDir(path, { loading: false, error: err.message });
      }
    }
  }

  async toggleDir(path: string, open?: boolean) {
    const isOpen = !!this.snap.expanded[path];
    const want = open ?? !isOpen;
    if (want === isOpen) return;
    if (want) {
      this.set({ expanded: { ...this.snap.expanded, [path]: true } });
      this.persist();
      if (!this.snap.dirs[path]?.entries) await this.loadDir(path);
    } else {
      const { [path]: _closed, ...rest } = this.snap.expanded;
      this.set({ expanded: rest });
      this.persist();
    }
  }

  collapseAll() {
    // Folders stay open; everything below them folds.
    this.set({ expanded: Object.fromEntries(this.snap.folders.map((f) => [f, true as const])) });
    this.persist();
  }

  /** Re-lists every expanded folder (focus return, Refresh button). */
  async refresh() {
    this.fileCache.clear();
    await Promise.all(Object.keys(this.snap.expanded).map((p) => this.loadDir(p)));
  }

  select(path: string | null) {
    if (this.snap.selected !== path) this.set({ selected: path });
  }

  /** Visible rows in tree order — keyboard navigation walks this. */
  visibleRows(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of this.snap.dirs[dir]?.entries ?? []) {
        out.push(e.path);
        if (e.isDir && this.snap.expanded[e.path]) walk(e.path);
      }
    };
    for (const f of this.snap.folders) {
      out.push(f);
      if (this.snap.expanded[f]) walk(f);
    }
    return out;
  }

  entry(path: string): DirEntry | null {
    const dir = this.snap.dirs[dirname(path)];
    return dir?.entries?.find((e) => e.path === path) ?? null;
  }

  isDir(path: string): boolean {
    return this.snap.folders.includes(path) || !!this.entry(path)?.isDir;
  }

  // ── files: create / rename / move / delete ─────────────────────────────

  async create(dir: string, name: string, kind: 'file' | 'dir'): Promise<string | null> {
    try {
      const path = kind === 'file' ? await this.fs.createFile(dir, name) : await this.fs.createDir(dir, name);
      this.fileCache.clear();
      // Every folder from `dir` down to the new entry opens, so a nested
      // "a/b/c.txt" lands visibly.
      const chain: string[] = [];
      for (let p = dirname(path); isUnder(p, dir); p = dirname(p)) {
        chain.push(p);
        if (p === dir) break;
      }
      this.set({ expanded: { ...this.snap.expanded, ...Object.fromEntries(chain.map((p) => [p, true as const])) } });
      await Promise.all(chain.map((p) => this.loadDir(p)));
      this.select(path);
      this.persist();
      if (kind === 'file') await this.openFile(path);
      return path;
    } catch (e) {
      this.fail(e);
      return null;
    }
  }

  /** Points tabs, expansion and selection at a renamed/moved entry. */
  private relocate(from: string, to: string) {
    const renamed: string[] = [];
    const tabs = this.snap.tabs.map((t) => {
      if (!isUnder(t.path, from)) return t;
      const path = rebase(t.path, from, to);
      const name = basename(path);
      if (name !== t.name) renamed.push(t.id);
      return { ...t, path, name };
    });
    const remap = <T>(rec: Record<string, T>) =>
      Object.fromEntries(Object.entries(rec).map(([p, v]) => [rebase(p, from, to), v]));
    this.set({
      tabs,
      expanded: remap(this.snap.expanded),
      dirs: remap(this.snap.dirs),
      selected: this.snap.selected ? rebase(this.snap.selected, from, to) : null,
      cut: this.snap.cut ? rebase(this.snap.cut, from, to) : null,
    });
    // The language may differ after a rename (.txt → .ts).
    for (const id of renamed) void this.applyLanguage(id);
    this.fileCache.clear();
    this.persist();
  }

  async rename(path: string, newName: string): Promise<boolean> {
    try {
      const to = await this.fs.rename(path, newName);
      this.relocate(path, to);
      await this.loadDir(dirname(to));
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async move(path: string, targetDir: string): Promise<boolean> {
    try {
      const to = await this.fs.move(path, targetDir);
      this.relocate(path, to);
      await Promise.all([this.loadDir(dirname(path)), this.loadDir(targetDir)]);
      this.set({ expanded: { ...this.snap.expanded, [targetDir]: true }, cut: null });
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  markCut(path: string | null) {
    this.set({ cut: path });
  }

  async paste(targetDir: string) {
    const src = this.snap.cut;
    if (src) await this.move(src, targetDir);
  }

  /** Deletes from disk; tabs under it close without saving. */
  async remove(path: string): Promise<void> {
    await this.fs.delete(path);
    this.closeTabs(this.snap.tabs.filter((t) => isUnder(t.path, path)).map((t) => t.id), { remember: false });
    const keep = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([p]) => !isUnder(p, path)));
    this.set({
      expanded: keep(this.snap.expanded),
      dirs: keep(this.snap.dirs),
      selected: this.snap.selected && isUnder(this.snap.selected, path) ? dirname(path) : this.snap.selected,
      cut: this.snap.cut && isUnder(this.snap.cut, path) ? null : this.snap.cut,
    });
    this.fileCache.clear();
    this.persist();
    await this.loadDir(dirname(path));
  }

  // ── Quick Open ─────────────────────────────────────────────────────────

  /** All files of all open folders; cached until something changes. */
  async allFiles(): Promise<{ files: (WalkEntry & { root: string })[]; truncated: boolean }> {
    let truncated = false;
    const lists = await Promise.all(this.snap.folders.map(async (root) => {
      let cached = this.fileCache.get(root);
      if (!cached) {
        cached = this.fs.listFiles(root).then((l) => { truncated ||= l.truncated; return l.files; });
        this.fileCache.set(root, cached);
        cached.catch(() => this.fileCache.delete(root));
      }
      try {
        return (await cached).map((f) => ({ ...f, root }));
      } catch (e) {
        this.fail(e);
        return [];
      }
    }));
    return { files: lists.flat(), truncated };
  }

  // ── tabs ───────────────────────────────────────────────────────────────

  private newTab(path: string): Tab {
    return {
      id: `t${nextId++}`, kind: 'file', untitledNo: null, path, name: basename(path), status: 'idle', error: null, errorCode: null, dirty: false, saving: false,
      eol: '\n', bom: false, modified: 0, size: 0, language: null, external: null,
    };
  }

  /** An untitled tab with its editor state ready (not yet in the strip). */
  private makeUntitled(key: string, no: number, content: string): Tab {
    const tab: Tab = {
      ...this.newTab(`${UNTITLED_PREFIX}${key}`),
      kind: 'untitled', untitledNo: no, status: 'ready', dirty: content.length > 0,
    };
    const state = this.createState(tab.id, content);
    tab.name = untitledTitle(state.doc, no);
    this.states.set(tab.id, state);
    this.saved.set(tab.id, Text.empty);
    return tab;
  }

  /** Lowest "Untitled-N" number not used by an open untitled tab. */
  private nextUntitledNo(): number {
    const used = new Set(this.snap.tabs.map((t) => t.untitledNo));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  private insertTab(tab: Tab) {
    const tabs = [...this.snap.tabs];
    const at = tabs.findIndex((t) => t.id === this.snap.activeId);
    tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
    this.set({ tabs, activeId: tab.id });
    this.persist();
    this.syncView(true);
  }

  /** ⌘N — a new untitled tab, no folder or file name needed. */
  newUntitled(content = '', key = newKey(), no = this.nextUntitledNo()): string {
    const tab = this.makeUntitled(key, no, content);
    this.insertTab(tab);
    if (content) this.scheduleBackup(tab.id);
    return tab.id;
  }

  /** Opens one file through the OS dialog (it need not be in an open folder). */
  async openFilePicker() {
    try {
      const path = await this.fs.pickFile();
      if (path) await this.openFile(path);
    } catch (e) {
      this.fail(e);
    }
  }

  // ── recently closed ────────────────────────────────────────────────────

  /** Reopens a closed tab (the most recent one without `key`). */
  async reopenClosed(key?: string) {
    const entry = key ? this.snap.closed.find((c) => c.key === key) : this.snap.closed[0];
    if (!entry) return;
    this.set({ closed: this.snap.closed.filter((c) => c !== entry) });
    this.persist();
    if (entry.kind === 'file') {
      await this.openFile(entry.path);
      return;
    }
    let content = '';
    try {
      content = (await this.fs.backups.read(entry.key)) ?? '';
    } catch (e) {
      this.fail(e);
    }
    const busy = this.snap.tabs.some((t) => t.untitledNo === entry.untitledNo);
    this.newUntitled(content, entry.key, busy ? this.nextUntitledNo() : entry.untitledNo);
    if (this.snap.notice?.restoreKey === entry.key) this.dismissNotice();
  }

  /** Forgets a closed entry for good (its backup is deleted). */
  discardClosed(key: string) {
    const entry = this.snap.closed.find((c) => c.key === key);
    if (!entry) return;
    this.set({ closed: this.snap.closed.filter((c) => c !== entry) });
    if (entry.kind === 'untitled') void this.fs.backups.delete(key).catch(() => {});
    this.persist();
  }

  clearClosed() {
    for (const c of this.snap.closed) if (c.kind === 'untitled') void this.fs.backups.delete(c.key).catch(() => {});
    this.set({ closed: [] });
    this.persist();
  }

  async openFile(path: string) {
    const existing = this.snap.tabs.find((t) => t.path === path);
    if (existing) {
      this.activate(existing.id);
      return;
    }
    // Opens to the right of the current tab, as editors do.
    const tab = this.newTab(path);
    const tabs = [...this.snap.tabs];
    const at = tabs.findIndex((t) => t.id === this.snap.activeId);
    tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
    this.set({ tabs, activeId: tab.id, selected: path });
    this.persist();
    this.syncView();
    await this.ensureLoaded(tab.id);
  }

  activate(id: string) {
    if (this.snap.activeId === id) return;
    const tab = this.tab(id);
    this.set({ activeId: id, selected: tab?.path ?? this.snap.selected });
    this.persist();
    this.syncView();
    void this.ensureLoaded(id).then(() => this.checkTab(id));
  }

  activateRelative(delta: number) {
    const { tabs, activeId } = this.snap;
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeId);
    this.activate(tabs[(i + delta + tabs.length) % tabs.length].id);
  }

  /** Closes without asking — callers check `dirty` first. An untitled tab
   *  with text moves to Recently closed (its backup kept); an empty one is
   *  discarded. With `remember` false (the file was deleted) a file tab is
   *  not offered for reopening. */
  closeTabs(ids: string[], { remember = true }: { remember?: boolean } = {}) {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const { tabs, activeId } = this.snap;
    const now = Date.now();
    const closedNow: ClosedEntry[] = [];
    for (const t of tabs) {
      if (!drop.has(t.id)) continue;
      if (t.kind === 'untitled') {
        const key = t.path.slice(UNTITLED_PREFIX.length);
        const doc = this.currentState(t.id)?.doc;
        if (doc && doc.length > 0) {
          // The latest text must be on disk before the tab's state is gone.
          void this.fs.backups.write(key, doc.toString()).catch((e) => this.fail(e));
          closedNow.push({ kind: 'untitled', key, name: t.name, untitledNo: t.untitledNo ?? 1, closedAt: now });
        } else {
          void this.fs.backups.delete(key).catch(() => {});
        }
        this.pendingBackups.delete(t.id);
      } else if (remember && t.status !== 'error') {
        closedNow.push({ kind: 'file', key: `f${now}-${t.id}`, path: t.path, name: t.name, closedAt: now });
      }
    }
    if (closedNow.length) {
      const paths = new Set(closedNow.map((c) => (c.kind === 'file' ? c.path : c.key)));
      const merged = [
        ...closedNow.reverse(),
        ...this.snap.closed.filter((c) => !paths.has(c.kind === 'file' ? c.path : c.key)),
      ];
      for (const evicted of merged.slice(MAX_CLOSED)) {
        if (evicted.kind === 'untitled') void this.fs.backups.delete(evicted.key).catch(() => {});
      }
      this.set({ closed: merged.slice(0, MAX_CLOSED) });
      const untitledClosed = closedNow.filter((c) => c.kind === 'untitled');
      if (untitledClosed.length === 1) {
        this.notify(untitledClosed[0].name, 'info', 'closedUntitled', untitledClosed[0].key);
      }
    }
    let nextActive = activeId;
    if (activeId && drop.has(activeId)) {
      // The neighbour that remains — right first, then left — like VS Code.
      const i = tabs.findIndex((t) => t.id === activeId);
      const right = tabs.slice(i + 1).find((t) => !drop.has(t.id));
      const left = [...tabs.slice(0, i)].reverse().find((t) => !drop.has(t.id));
      nextActive = (right ?? left)?.id ?? null;
    }
    if (this.viewTabId && drop.has(this.viewTabId)) this.viewTabId = null;
    for (const id of ids) {
      this.states.delete(id);
      this.saved.delete(id);
      this.scroll.delete(id);
    }
    this.set({ tabs: tabs.filter((t) => !drop.has(t.id)), activeId: nextActive });
    this.persist();
    this.syncView();
    if (nextActive) void this.ensureLoaded(nextActive);
  }

  closeTab(id: string) {
    this.closeTabs([id]);
  }

  private async ensureLoaded(id: string) {
    const tab = this.tab(id);
    if (!tab || tab.status !== 'idle') return;
    await this.load(id);
  }

  private async load(id: string) {
    const tab = this.tab(id);
    if (!tab) return;
    this.patchTab(id, { status: 'loading', error: null, errorCode: null });
    try {
      const file = await this.fs.readFile(tab.path);
      if (!this.tab(id)) return;
      if (file.binary) {
        this.patchTab(id, { status: 'binary', size: file.size, modified: file.modified, external: null });
        return;
      }
      const state = this.createState(id, file.content);
      this.states.set(id, state);
      this.saved.set(id, state.doc);
      this.patchTab(id, {
        status: 'ready', dirty: false, eol: detectEol(file.content), bom: file.bom,
        size: file.size, modified: file.modified, external: null,
      });
      this.syncView(true);
      await this.applyLanguage(id);
    } catch (e) {
      const err = toFsError(e);
      this.patchTab(id, { status: 'error', error: err.message, errorCode: err.code });
    }
  }

  private async applyLanguage(id: string) {
    const tab = this.tab(id);
    if (!tab || tab.status !== 'ready') return;
    const lang = await loadLanguage(tab.name);
    if (!this.tab(id)) return;
    this.dispatchTo(id, this.langSlot.reconfigure(lang?.support ?? []));
    this.patchTab(id, { language: lang?.name ?? null });
  }

  /** Throws away unsaved edits and re-reads the file from disk. */
  async reload(id: string) {
    const tab = this.tab(id);
    if (!tab || tab.kind === 'untitled') return;
    if (tab.status !== 'ready') {
      await this.load(id);
      return;
    }
    try {
      const file = await this.fs.readFile(tab.path);
      if (file.binary) {
        await this.load(id);
        return;
      }
      const state = this.states.get(id);
      if (!state) return;
      // Replace the document as one undoable change, so a reload that
      // dropped something you wanted is a single ⌘Z away.
      this.dispatchSpec(id, { changes: { from: 0, to: state.doc.length, insert: file.content } });
      this.saved.set(id, this.states.get(id)!.doc);
      this.patchTab(id, {
        dirty: false, eol: detectEol(file.content), bom: file.bom, size: file.size,
        modified: file.modified, external: null,
      });
    } catch (e) {
      const err = toFsError(e);
      if (err.code === 'not_found') this.patchTab(id, { external: 'deleted' });
      else this.fail(err);
    }
  }

  /** Dismisses the "changed on disk" banner, keeping the editor's text. */
  keepMine(id: string) {
    this.patchTab(id, { external: null, modified: 0 });
  }

  // ── save ───────────────────────────────────────────────────────────────

  /** `force` skips the conflict check (the user chose Overwrite). */
  async save(id: string, force = false): Promise<SaveResult> {
    const tab = this.tab(id);
    const state = this.currentState(id);
    if (!tab || !state || tab.status !== 'ready') return 'skipped';
    if (tab.kind === 'untitled') return this.saveAs(id);
    let content = state.doc.toString();
    if (tab.eol === '\r\n') content = content.replace(/\n/g, '\r\n');
    this.patchTab(id, { saving: true });
    try {
      let stat;
      try {
        stat = await this.fs.writeFile(tab.path, content, {
          bom: tab.bom,
          expectedModified: force || !tab.modified ? undefined : tab.modified,
        });
      } catch (e) {
        const err = toFsError(e);
        // Deleted on disk while open: saving recreates it, as VS Code does.
        if (err.code !== 'not_found') throw err;
        const created = await this.fs.createFile(dirname(tab.path), basename(tab.path));
        stat = await this.fs.writeFile(created, content, { bom: tab.bom });
        void this.loadDir(dirname(tab.path));
      }
      this.saved.set(id, state.doc);
      const now = this.currentState(id);
      this.patchTab(id, {
        saving: false, modified: stat.modified, size: stat.size, external: null,
        dirty: now ? !now.doc.eq(state.doc) : false,
      });
      return 'saved';
    } catch (e) {
      const err = toFsError(e);
      this.patchTab(id, { saving: false });
      if (err.code === 'conflict') return 'conflict';
      this.fail(err);
      return 'failed';
    }
  }

  /** Save As: the OS Save dialog picks the place. An untitled tab becomes a
   *  normal file tab (its backup is dropped); a file tab moves to the copy. */
  async saveAs(id: string): Promise<SaveResult> {
    const tab = this.tab(id);
    const state = this.currentState(id);
    if (!tab || !state || tab.status !== 'ready') return 'skipped';
    let content = state.doc.toString();
    if (tab.eol === '\r\n') content = content.replace(/\n/g, '\r\n');
    let path: string | null;
    this.patchTab(id, { saving: true });
    try {
      path = await this.fs.saveAs(content, suggestFileName(tab), { bom: tab.bom });
    } catch (e) {
      this.patchTab(id, { saving: false });
      this.fail(e);
      return 'failed';
    }
    if (!path) {
      this.patchTab(id, { saving: false });
      return 'cancelled';
    }
    // Another tab showing that file holds what was just overwritten.
    const other = this.snap.tabs.find((t) => t.path === path && t.id !== id);
    if (other) this.closeTabs([other.id], { remember: false });
    let modified = 0;
    let size = content.length;
    try {
      const stat = await this.fs.stat(path);
      modified = stat.modified;
      size = stat.size;
    } catch { /* the conflict check is simply skipped next time */ }
    const wasUntitled = tab.kind === 'untitled';
    this.saved.set(id, state.doc);
    const now = this.currentState(id);
    this.patchTab(id, {
      kind: 'file', untitledNo: null, path, name: basename(path), saving: false, modified, size,
      external: null, dirty: now ? !now.doc.eq(state.doc) : false,
    });
    if (wasUntitled) {
      this.pendingBackups.delete(id);
      void this.fs.backups.delete(tab.path.slice(UNTITLED_PREFIX.length)).catch(() => {});
    }
    this.persist();
    this.fileCache.clear();
    if (this.rootOf(path)) {
      void this.loadDir(dirname(path));
      this.select(path);
    }
    await this.applyLanguage(id);
    return 'saved';
  }

  // ── external changes ───────────────────────────────────────────────────

  /** Compares a loaded tab with disk: reloads a clean tab silently, flags a
   *  dirty one. Run on window focus and on tab activation. */
  async checkTab(id: string) {
    const tab = this.tab(id);
    if (!tab || tab.kind === 'untitled' || (tab.status !== 'ready' && tab.status !== 'binary') || tab.saving) return;
    try {
      const stat = await this.fs.stat(tab.path);
      const current = this.tab(id);
      if (!current || !current.modified || stat.modified === current.modified) return;
      if (current.dirty) this.patchTab(id, { external: 'changed' });
      else await this.reload(id);
    } catch (e) {
      const err = toFsError(e);
      if (err.code === 'not_found') this.patchTab(id, { external: 'deleted' });
    }
  }

  async checkAll() {
    await Promise.all([this.refresh(), ...this.snap.tabs.map((t) => this.checkTab(t.id))]);
  }

  // ── CodeMirror plumbing ────────────────────────────────────────────────

  setDark(dark: boolean) {
    if (this.dark === dark) return;
    this.dark = dark;
    this.view?.dispatch({ effects: this.themeSlot.reconfigure(this.themeExtension()) });
  }

  toggleWrap() {
    const wrap = !this.snap.wrap;
    this.set({ wrap });
    this.persist();
    this.view?.dispatch({ effects: this.wrapSlot.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  private themeExtension(): Extension {
    return codeThemeWithHighlight(this.dark, { gutter: 'flush', paddingX: 8 });
  }

  private createState(id: string, doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        keymap.of([indentWithTab]),
        basicSetup,
        smartBracketSkip,
        EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
        this.themeSlot.of(this.themeExtension()),
        this.langSlot.of([]),
        this.wrapSlot.of(this.snap.wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.onDocChanged(id, u.state);
          if (u.selectionSet || u.docChanged) this.updateCursor(u.state);
        }),
      ],
    });
  }

  private onDocChanged(id: string, state: EditorState) {
    this.states.set(id, state);
    const tab = this.tab(id);
    const saved = this.saved.get(id);
    const dirty = !saved || !state.doc.eq(saved);
    const patch: Partial<Tab> = {};
    if (tab?.dirty !== dirty) patch.dirty = dirty;
    if (tab?.kind === 'untitled') {
      const name = untitledTitle(state.doc, tab.untitledNo ?? 1);
      if (name !== tab.name) patch.name = name;
      this.scheduleBackup(id);
    }
    if (Object.keys(patch).length) this.patchTab(id, patch);
  }

  private updateCursor(state: EditorState) {
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const next = { line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) };
    const c = this.cursor;
    if (c.line === next.line && c.col === next.col && c.selected === next.selected) return;
    this.cursor = next;
    for (const fn of this.cursorListeners) fn();
  }

  /** The tab's live state — the view's when it is showing that tab. */
  currentState(id: string): EditorState | null {
    if (this.view && this.viewTabId === id) return this.view.state;
    return this.states.get(id) ?? null;
  }

  private dispatchTo(id: string, effects: StateEffect<unknown>) {
    this.dispatchSpec(id, { effects });
  }

  private dispatchSpec(id: string, spec: TransactionSpec) {
    if (this.view && this.viewTabId === id) {
      this.view.dispatch(spec);
      this.states.set(id, this.view.state);
      return;
    }
    const state = this.states.get(id);
    if (!state) return;
    const tr = state.update(spec);
    this.states.set(id, tr.state);
    if (tr.docChanged) this.onDocChanged(id, tr.state);
  }

  attachView(view: EditorView | null) {
    if (this.view && this.viewTabId) {
      this.states.set(this.viewTabId, this.view.state);
      this.scroll.set(this.viewTabId, this.view.scrollDOM.scrollTop);
    }
    this.view = view;
    this.viewTabId = null;
    if (view) this.syncView();
  }

  /** Focuses the editor after the next paint: right after the first tab
   *  opens, the view's container is still `hidden` (display: none) until
   *  React re-renders, and focusing a hidden element does nothing. */
  focusEditor() {
    requestAnimationFrame(() => this.view?.focus());
  }

  /** Puts the active tab's state into the view. `force` re-installs it even
   *  when the same tab is showing (its state was just created). */
  private syncView(force = false) {
    const view = this.view;
    if (!view) return;
    const activeId = this.snap.activeId;
    if (!force && this.viewTabId === activeId) return;
    if (this.viewTabId && this.viewTabId !== activeId && this.states.has(this.viewTabId)) {
      this.states.set(this.viewTabId, view.state);
      this.scroll.set(this.viewTabId, view.scrollDOM.scrollTop);
    }
    const state = activeId ? this.states.get(activeId) : undefined;
    if (!state || !activeId) {
      this.viewTabId = null;
      return;
    }
    if (this.viewTabId === activeId && view.state === state) return;
    view.setState(state);
    this.viewTabId = activeId;
    // A stored state keeps the theme/wrap it was created or last shown with.
    view.dispatch({
      effects: [
        this.themeSlot.reconfigure(this.themeExtension()),
        this.wrapSlot.reconfigure(this.snap.wrap ? EditorView.lineWrapping : []),
      ],
    });
    this.updateCursor(view.state);
    const top = this.scroll.get(activeId) ?? 0;
    requestAnimationFrame(() => { if (this.viewTabId === activeId) view.scrollDOM.scrollTop = top; });
  }
}
