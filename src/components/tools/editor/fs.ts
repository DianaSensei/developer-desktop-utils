// The Text Editor's filesystem boundary. In the desktop app every call goes
// to a Rust `editor_*` command (src-tauri/src/editor.rs), which only touches
// paths inside folders the user opened through the OS picker. In the browser
// build (`npm run dev`, tests) there is no filesystem to reach, so an
// in-memory workspace stands in with the same semantics and error codes.

import type { PluginSdk } from '@/platform';
import type { TextSearchQuery, TextSearchResult } from './textSearch';

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  /** ms since the Unix epoch; 0 when unknown. */
  modified: number;
}

export interface DirListing {
  entries: DirEntry[];
  /** The folder had more entries than the backend lists at once. */
  truncated: boolean;
}

export interface FileContent {
  content: string;
  binary: boolean;
  bom: boolean;
  size: number;
  modified: number;
}

/** Above this a file opens in the read-only viewer instead of the editor
 *  (matches MAX_EDIT_BYTES in editor_fs.rs). */
export const MAX_EDIT_BYTES = 200 * 1024 * 1024;
/** Above this an editable file runs in "large file" mode: no highlighting,
 *  bracket colors, indent guides, formatting or Local History (VS Code turns
 *  the same things off for large files). */
export const LARGE_FILE_BYTES = 10 * 1024 * 1024;

export interface ViewStatus {
  size: number;
  lines: number;
  scanned: number;
  done: boolean;
  binary: boolean;
  /** Bumped when the file shrank and indexing started over. */
  generation: number;
}

export interface ViewLine {
  text: string;
  truncated: boolean;
}

export interface SearchHit {
  line: number;
  /** Match offset (characters) within `preview`. */
  column: number;
  /** Match offset (characters) within the whole line. */
  lineColumn: number;
  length: number;
  preview: string;
}

export interface SearchResult {
  hits: SearchHit[];
  nextLine: number | null;
  partial: boolean;
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  fromLine: number;
  maxHits?: number;
}

/** The read-only large-file viewer (editor_view.rs): lines are read from disk
 *  on demand through a background-built line index. */
export interface ViewerStore {
  open(path: string): Promise<{ id: number; status: ViewStatus }>;
  status(id: number): Promise<ViewStatus>;
  lines(id: number, start: number, count: number): Promise<ViewLine[]>;
  /** Indexes what was appended since last time (tail -f). */
  refresh(id: number): Promise<ViewStatus>;
  search(id: number, opts: SearchOptions): Promise<SearchResult>;
  close(id: number): Promise<void>;
}

export interface FileStat {
  size: number;
  modified: number;
  isDir: boolean;
}

export interface WalkEntry {
  path: string;
  /** Root-relative, `/`-separated. */
  rel: string;
}

export interface FileList {
  files: WalkEntry[];
  truncated: boolean;
}

/** Codes match `FsError::code` in editor_fs.rs. */
export type FsErrorCode =
  | 'denied' | 'not_found' | 'exists' | 'conflict' | 'too_large' | 'invalid_name'
  | 'root' | 'invalid_move' | 'not_dir' | 'is_dir' | 'permission' | 'io' | 'invalid_regex' | 'unknown';

export class EditorFsError extends Error {
  constructor(public code: FsErrorCode, message: string) {
    super(message);
    this.name = 'EditorFsError';
  }
}

/** Normalises whatever a backend call rejected with. Tauri rejects with the
 *  serialised `FsError` object; SDK permission errors are plain `Error`s. */
export function toFsError(e: unknown): EditorFsError {
  if (e instanceof EditorFsError) return e;
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: unknown; message: unknown };
    return new EditorFsError(String(code) as FsErrorCode, String(message));
  }
  if (e instanceof Error) return new EditorFsError('unknown', e.message);
  return new EditorFsError('unknown', String(e));
}

export interface WriteOptions {
  bom?: boolean;
  /** mtime the editor last saw; the write fails with `conflict` if it moved. */
  expectedModified?: number;
}

export interface EditorFs {
  /** `memory` = the browser-only demo workspace. */
  readonly kind: 'native' | 'memory';
  /** OS folder picker; resolves to the folder (now authorised) or null. */
  pickFolder(): Promise<string | null>;
  /** Every authorised folder, oldest first. */
  roots(): Promise<string[]>;
  /** Single files authorised through Save As / Open File, oldest first. */
  authorisedFiles(): Promise<string[]>;
  /** OS file picker for one file; resolves to it (now authorised) or null. */
  pickFile(): Promise<string | null>;
  /** OS Save dialog; writes `content` there and resolves to the path, or null. */
  saveAs(content: string, suggestedName: string, opts?: { bom?: boolean }): Promise<string | null>;
  forgetRoot(path: string): Promise<void>;
  listDir(path: string): Promise<DirListing>;
  listFiles(root: string, limit?: number): Promise<FileList>;
  /** Search (⌘⇧F): text in every file under the opened folders. A newer
   *  call stops an older one (its result comes back `cancelled`). */
  searchText(query: TextSearchQuery): Promise<TextSearchResult>;
  cancelSearch(): Promise<void>;
  stat(path: string): Promise<FileStat>;
  readFile(path: string): Promise<FileContent>;
  writeFile(path: string, content: string, opts?: WriteOptions): Promise<FileStat>;
  /** `name` may contain `/` to create intermediate folders. Returns the new path. */
  createFile(dir: string, name: string): Promise<string>;
  createDir(dir: string, name: string): Promise<string>;
  rename(path: string, newName: string): Promise<string>;
  move(path: string, targetDir: string): Promise<string>;
  delete(path: string): Promise<void>;
  /** Content of untitled tabs, one entry per key, outside the settings store. */
  readonly backups: BackupStore;
  /** Local History: snapshots of a file taken on save (editor_history.rs). */
  readonly history: HistoryStore;
  readonly viewer: ViewerStore;
}

export type SnapshotSource = 'save' | 'previous' | 'restore';

export interface HistoryEntry {
  id: string;
  /** ms since the Unix epoch. */
  ts: number;
  size: number;
  hash: string;
  source: SnapshotSource;
}

export interface HistoryStore {
  /** Null when identical to the newest snapshot (nothing recorded). */
  add(path: string, content: string, source: SnapshotSource): Promise<HistoryEntry | null>;
  /** Newest first. */
  list(path: string): Promise<HistoryEntry[]>;
  read(path: string, id: string): Promise<string>;
  delete(path: string, id: string): Promise<void>;
  clear(path: string): Promise<void>;
}

export interface BackupStore {
  list(): Promise<string[]>;
  read(key: string): Promise<string | null>;
  write(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createNativeFs(sdk: PluginSdk): EditorFs {
  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await sdk.native.invoke<T>(cmd, args);
    } catch (e) {
      throw toFsError(e);
    }
  };
  return {
    kind: 'native',
    pickFolder: () => call<string | null>('editor_pick_folder'),
    roots: () => call<string[]>('editor_roots'),
    authorisedFiles: () => call<string[]>('editor_authorised_files'),
    pickFile: () => call<string | null>('editor_pick_file'),
    saveAs: (content, suggestedName, opts = {}) =>
      call<string | null>('editor_save_as', { content, suggestedName, bom: opts.bom ?? false }),
    forgetRoot: async (path) => { await call<boolean>('editor_forget_root', { path }); },
    listDir: (path) => call<DirListing>('editor_list_dir', { path }),
    listFiles: (root, limit) => call<FileList>('editor_list_files', { root, limit }),
    searchText: (query) => call<TextSearchResult>('editor_search', { query }),
    cancelSearch: () => call<void>('editor_search_cancel'),
    stat: (path) => call<FileStat>('editor_stat', { path }),
    // Both directions as raw bytes: a 200 MB file must not become a JSON
    // string on the way through the IPC bridge.
    readFile: async (path) => decodeFramed(await call<ArrayBuffer>('editor_read_file', { path })),
    writeFile: async (path, content, opts = {}) => {
      try {
        return await sdk.native.invoke<FileStat>('editor_write_file', new TextEncoder().encode(content), {
          headers: {
            'x-path': encodeURIComponent(path),
            'x-bom': opts.bom ? '1' : '0',
            ...(opts.expectedModified ? { 'x-expected-modified': String(opts.expectedModified) } : {}),
          },
        });
      } catch (e) {
        throw toFsError(e);
      }
    },
    viewer: {
      open: (path) => call<{ id: number; status: ViewStatus }>('editor_view_open', { path }),
      status: (id) => call<ViewStatus>('editor_view_status', { id }),
      lines: (id, start, count) => call<ViewLine[]>('editor_view_lines', { id, start, count }),
      refresh: (id) => call<ViewStatus>('editor_view_refresh', { id }),
      search: (id, o) => call<SearchResult>('editor_view_search', {
        id, query: o.query, regex: o.regex, caseSensitive: o.caseSensitive, fromLine: o.fromLine, maxHits: o.maxHits,
      }),
      close: async (id) => { await call<void>('editor_view_close', { id }); },
    },
    createFile: (dir, name) => call<string>('editor_create_file', { dir, name }),
    createDir: (dir, name) => call<string>('editor_create_dir', { dir, name }),
    rename: (path, newName) => call<string>('editor_rename', { path, newName }),
    move: (path, targetDir) => call<string>('editor_move', { path, targetDir }),
    delete: (path) => call<void>('editor_delete', { path }),
    history: {
      add: (path, content, source) => call<HistoryEntry | null>('editor_history_add', { path, content, source }),
      list: (path) => call<HistoryEntry[]>('editor_history_list', { path }),
      read: (path, id) => call<string>('editor_history_read', { path, id }),
      delete: (path, id) => call<void>('editor_history_delete', { path, id }),
      clear: (path) => call<void>('editor_history_clear', { path }),
    },
    backups: {
      list: () => call<string[]>('editor_backup_list'),
      read: (key) => call<string | null>('editor_backup_read', { key }),
      write: (key, content) => call<void>('editor_backup_write', { key, content }),
      delete: (key) => call<void>('editor_backup_delete', { key }),
    },
  };
}

/** Unpacks `editor_read_file`'s reply: u32 LE metadata length, metadata JSON,
 *  then the UTF-8 text (see `Roots::read_framed`). */
export function decodeFramed(buf: ArrayBuffer): FileContent {
  const view = new DataView(buf);
  const metaLen = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen))) as Omit<FileContent, 'content'>;
  const content = meta.binary ? '' : new TextDecoder().decode(new Uint8Array(buf, 4 + metaLen));
  return { ...meta, content };
}
