// The Text Editor's filesystem boundary. In the desktop app every call goes
// to a Rust `editor_*` command (src-tauri/src/editor.rs), which only touches
// paths inside folders the user opened through the OS picker. In the browser
// build (`npm run dev`, tests) there is no filesystem to reach, so an
// in-memory workspace stands in with the same semantics and error codes.

import type { PluginSdk } from '@/platform';

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
  | 'root' | 'invalid_move' | 'not_dir' | 'is_dir' | 'permission' | 'io' | 'unknown';

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
    stat: (path) => call<FileStat>('editor_stat', { path }),
    readFile: (path) => call<FileContent>('editor_read_file', { path }),
    writeFile: (path, content, opts = {}) => call<FileStat>('editor_write_file', {
      path, content, bom: opts.bom ?? false, expectedModified: opts.expectedModified,
    }),
    createFile: (dir, name) => call<string>('editor_create_file', { dir, name }),
    createDir: (dir, name) => call<string>('editor_create_dir', { dir, name }),
    rename: (path, newName) => call<string>('editor_rename', { path, newName }),
    move: (path, targetDir) => call<string>('editor_move', { path, targetDir }),
    delete: (path) => call<void>('editor_delete', { path }),
    backups: {
      list: () => call<string[]>('editor_backup_list'),
      read: (key) => call<string | null>('editor_backup_read', { key }),
      write: (key, content) => call<void>('editor_backup_write', { key, content }),
      delete: (key) => call<void>('editor_backup_delete', { key }),
    },
  };
}
