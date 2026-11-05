// Export / import of saved settings, for one tool or the whole app, as a
// JSON file the user can keep, move to another machine and load back.
//
// What is in a file:
// - `tools`: each tool's namespace in the settings store
//   (`devtool:<toolId>:<key>`) — its options, collections, history, tasks…,
//   exactly as stored (raw strings, so every value round-trips unchanged);
// - `app` (whole-app export only): the shell's own `devtool-*` keys — theme,
//   language, fonts, workspaces and tabs, sidebar order, favorites, shortcuts.
//
// What is never in a file: the encrypted secret vault (2FA seeds, API
// tokens, passwords, the Jira token — platform/secrets.ts), files on disk
// (Text Editor folders and Local History), and per-machine bookkeeping
// (pending update, last update check).
//
// Import writes straight into the store, then the app reloads so every tool
// starts from the imported values. Before writing, the current values of
// every key it touches are kept as one undo snapshot (`undoLastImport`).

import {
  flushPersistentStore, freezeWrites, setThemePreference, storageGet, storageKeys, storageRemove, storageSet,
} from '@/lib/persistentStore';

export const CONFIG_FORMAT = 'devtool-config';
export const CONFIG_VERSION = 1;

/** One undo level: the values the last import (or reset) replaced. */
export const UNDO_KEY = 'devtool-config-undo';
/** Set just before the reload, read once after it to show "Imported … · Undo". */
export const NOTICE_KEY = 'devtool-config-notice';

const TOOL_PREFIX = 'devtool:';
const APP_PREFIX = 'devtool-';
const TOOL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** App keys that describe this machine or this session, not preferences. */
const APP_EXCLUDED = new Set([
  'devtool-pending-update',
  'devtool-last-update-check',
  'devtool-theme-shadow',
  UNDO_KEY,
  NOTICE_KEY,
]);

export interface ConfigFile {
  format: typeof CONFIG_FORMAT;
  version: number;
  exportedAt: string;
  appVersion?: string;
  /** Tool id → storage key (without the `devtool:<id>:` prefix) → stored string. */
  tools: Record<string, Record<string, string>>;
  /** App-wide settings (`devtool-*` key → stored string); whole-app exports only. */
  app?: Record<string, string>;
}

export interface ToolSummary {
  id: string;
  keys: number;
  /** Approximate size of the stored text, in bytes. */
  bytes: number;
}

const toolPrefix = (id: string) => `${TOOL_PREFIX}${id}:`;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

function isAppKey(key: string): boolean {
  return key.startsWith(APP_PREFIX) && !APP_EXCLUDED.has(key);
}

/** Saved values of one tool, keyed without the namespace prefix. */
export function readToolData(id: string): Record<string, string> {
  const prefix = toolPrefix(id);
  const out: Record<string, string> = {};
  for (const key of storageKeys()) {
    if (!key.startsWith(prefix)) continue;
    const value = storageGet(key);
    if (value !== null) out[key.slice(prefix.length)] = value;
  }
  return out;
}

export function readAppData(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of storageKeys()) {
    if (!isAppKey(key)) continue;
    const value = storageGet(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Every tool that has saved data, largest first. */
export function toolsWithData(): ToolSummary[] {
  const map = new Map<string, ToolSummary>();
  for (const key of storageKeys()) {
    if (!key.startsWith(TOOL_PREFIX)) continue;
    const rest = key.slice(TOOL_PREFIX.length);
    const id = rest.slice(0, rest.indexOf(':'));
    if (!id || !TOOL_ID.test(id)) continue;
    const entry = map.get(id) ?? { id, keys: 0, bytes: 0 };
    entry.keys++;
    entry.bytes += byteLength(storageGet(key) ?? '') + byteLength(key);
    map.set(id, entry);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

export function summarizeApp(data: Record<string, string> = readAppData()): { keys: number; bytes: number } {
  const entries = Object.entries(data);
  return { keys: entries.length, bytes: entries.reduce((n, [k, v]) => n + byteLength(k) + byteLength(v), 0) };
}

export function buildExport(opts: { toolIds: string[]; includeApp: boolean; appVersion?: string; now?: Date }): ConfigFile {
  const tools: ConfigFile['tools'] = {};
  for (const id of opts.toolIds) {
    const data = readToolData(id);
    if (Object.keys(data).length) tools[id] = data;
  }
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    tools,
    ...(opts.includeApp ? { app: readAppData() } : {}),
  };
}

/** Pretty JSON, stable key order, for a file people may diff or read. */
export function serializeConfig(file: ConfigFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `devtool-config-2026-11-05.json`, or `devtool-api-client-config-…` for one tool. */
export function exportFileName(toolIds: string[], includeApp: boolean, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const scope = !includeApp && toolIds.length === 1 ? `${toolIds[0]}-` : '';
  return `devtool-${scope}config-${day}.json`;
}

export type ParseError = 'notJson' | 'wrongFormat' | 'newerVersion' | 'empty';

/** Reads and validates a config file. Anything that is not a string-to-string
 *  map in the right place is dropped, never written. */
export function parseConfigFile(text: string): { ok: true; file: ConfigFile } | { ok: false; error: ParseError } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'notJson' };
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== CONFIG_FORMAT) {
    return { ok: false, error: 'wrongFormat' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'number' || r.version > CONFIG_VERSION) return { ok: false, error: 'newerVersion' };

  const strings = (o: unknown, keyOk: (k: string) => boolean): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && keyOk(k)) out[k] = v;
    }
    return out;
  };
  const tools: ConfigFile['tools'] = {};
  if (r.tools && typeof r.tools === 'object' && !Array.isArray(r.tools)) {
    for (const [id, data] of Object.entries(r.tools as Record<string, unknown>)) {
      if (!TOOL_ID.test(id)) continue;
      const clean = strings(data, (k) => k.length > 0 && k.length <= 256);
      if (Object.keys(clean).length) tools[id] = clean;
    }
  }
  const app = r.app !== undefined ? strings(r.app, isAppKey) : undefined;
  const file: ConfigFile = {
    format: CONFIG_FORMAT,
    version: r.version,
    exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : '',
    ...(typeof r.appVersion === 'string' ? { appVersion: r.appVersion } : {}),
    tools,
    ...(app && Object.keys(app).length ? { app } : {}),
  };
  if (!Object.keys(tools).length && !file.app) return { ok: false, error: 'empty' };
  return { ok: true, file };
}

export function summarizeFile(file: ConfigFile): ToolSummary[] {
  return Object.entries(file.tools)
    .map(([id, data]) => ({
      id,
      keys: Object.keys(data).length,
      bytes: Object.entries(data).reduce((n, [k, v]) => n + byteLength(k) + byteLength(v), 0),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── Writing ─────────────────────────────────────────────────────────────

export type ImportMode = 'replace' | 'merge';

export interface UndoSnapshot {
  at: string;
  /** What the change was, for the "Undo …" label. */
  label: string;
  /** Full storage key → previous value (null = the key did not exist). */
  entries: Record<string, string | null>;
}

interface Change {
  /** Full storage key → new value (null = remove). */
  writes: Map<string, string | null>;
}

function planImport(file: ConfigFile, opts: { toolIds: string[]; includeApp: boolean; mode: ImportMode }): Change {
  const writes = new Map<string, string | null>();
  for (const id of opts.toolIds) {
    const data = file.tools[id];
    if (!data) continue;
    const prefix = toolPrefix(id);
    // Replace: the tool ends up with exactly the file's keys.
    if (opts.mode === 'replace') {
      for (const key of storageKeys()) if (key.startsWith(prefix)) writes.set(key, null);
    }
    for (const [k, v] of Object.entries(data)) writes.set(prefix + k, v);
  }
  if (opts.includeApp && file.app) {
    for (const [k, v] of Object.entries(file.app)) if (isAppKey(k)) writes.set(k, v);
  }
  return { writes };
}

function apply(change: Change, label: string, now: Date): number {
  const entries: UndoSnapshot['entries'] = {};
  for (const key of change.writes.keys()) entries[key] = storageGet(key);
  const snapshot: UndoSnapshot = { at: now.toISOString(), label, entries };
  storageSet(UNDO_KEY, JSON.stringify(snapshot));
  let changed = 0;
  for (const [key, value] of change.writes) {
    if (storageGet(key) === value) continue;
    changed++;
    if (value === null) storageRemove(key);
    else if (key === 'devtool-theme' && (value === 'light' || value === 'dark' || value === 'system')) setThemePreference(value);
    else storageSet(key, value);
  }
  return changed;
}

/** Writes the chosen parts of `file`; returns how many keys changed. */
export function importConfig(
  file: ConfigFile,
  opts: { toolIds: string[]; includeApp: boolean; mode: ImportMode; label: string; now?: Date },
): number {
  return apply(planImport(file, opts), opts.label, opts.now ?? new Date());
}

/** Clears one tool's saved data (undoable like an import). */
export function resetToolData(id: string, label: string, now = new Date()): number {
  const writes = new Map<string, string | null>();
  for (const key of storageKeys()) if (key.startsWith(toolPrefix(id))) writes.set(key, null);
  return apply({ writes }, label, now);
}

export function readUndo(): UndoSnapshot | null {
  try {
    const raw = storageGet(UNDO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as UndoSnapshot;
    return s && typeof s.entries === 'object' && typeof s.at === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** Puts back what the last import or reset replaced; returns keys restored. */
export function undoLastImport(): number {
  const s = readUndo();
  if (!s) return 0;
  let n = 0;
  for (const [key, value] of Object.entries(s.entries)) {
    if (!(key.startsWith(TOOL_PREFIX) || isAppKey(key))) continue;
    n++;
    if (value === null) storageRemove(key);
    else if (key === 'devtool-theme' && (value === 'light' || value === 'dark' || value === 'system')) setThemePreference(value);
    else storageSet(key, value);
  }
  storageRemove(UNDO_KEY);
  return n;
}

// ── Reload ──────────────────────────────────────────────────────────────

export interface ImportNotice {
  kind: 'import' | 'reset' | 'undo';
  label: string;
  changed: number;
}

/** Saves the store, leaves a one-time notice, and reloads the app so every
 *  tool starts from the new values. Further writes from the page being torn
 *  down are dropped (`freezeWrites`), so a tool's own pending save cannot overwrite
 *  what was just imported. */
export async function reloadWith(notice: ImportNotice): Promise<void> {
  storageSet(NOTICE_KEY, JSON.stringify(notice));
  await flushPersistentStore();
  freezeWrites();
  window.location.reload();
}

/** The notice left by `reloadWith`, once. */
export function takeNotice(): ImportNotice | null {
  const raw = storageGet(NOTICE_KEY);
  if (!raw) return null;
  storageRemove(NOTICE_KEY);
  try {
    return JSON.parse(raw) as ImportNotice;
  } catch {
    return null;
  }
}
