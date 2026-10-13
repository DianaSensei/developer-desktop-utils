import type { PluginPermission } from './types';

/**
 * Audit log of plugin → SDK calls, including denied ones (a denied call is
 * otherwise a silent failure the user cannot diagnose).
 *
 * An in-memory ring buffer for inspecting the current session. Not written
 * to disk, which would add rotation, size limits and a risk of persisting
 * sensitive URLs or keys.
 */

export type AuditChannel =
  | 'storage'
  | 'secrets'
  | 'clipboard'
  | 'files'
  | 'shell'
  | 'http'
  | 'native'
  | 'service'
  | 'lifecycle';

export interface AuditEntry {
  ts: number;
  pluginId: string;
  channel: AuditChannel;
  /** Specific action: 'get', 'set', 'fetch', a Tauri command name... */
  action: string;
  allowed: boolean;
  /** Missing permission, when denied for that reason. */
  missingPermission?: PluginPermission;
  /** Short detail without values: storage key, URL origin... */
  detail?: string;
}

const MAX_ENTRIES = 500;

const entries: AuditEntry[] = [];
const listeners = new Set<(entry: AuditEntry) => void>();

export function record(entry: Omit<AuditEntry, 'ts'>): void {
  const full: AuditEntry = { ...entry, ts: Date.now() };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const fn of listeners) {
    try {
      fn(full);
    } catch {
      // A failing listener must not break the SDK call.
    }
  }
}

/** Newest first, at most `limit`. */
export function recent(limit = MAX_ENTRIES): AuditEntry[] {
  return entries.slice(-limit).reverse();
}

/** Entries for one plugin, for the Settings activity panel. */
export function recentFor(pluginId: string, limit = MAX_ENTRIES): AuditEntry[] {
  return entries.filter((e) => e.pluginId === pluginId).slice(-limit).reverse();
}

export function subscribe(fn: (entry: AuditEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test only: clears the buffer. */
export function clear(): void {
  entries.length = 0;
}

/**
 * File name only, for the log. Full paths include the home directory and so
 * the user's account name.
 */
export function describePath(path: string): string {
  const name = path.split(/[\\/]/).pop();
  return name && name.length > 0 ? name : '<đường dẫn rỗng>';
}

/**
 * Origin only (scheme, host, port), for the log: paths and queries often
 * hold tokens. No base URL is used, so a relative URL is logged as invalid
 * rather than resolved against the webview's origin.
 */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '<url không hợp lệ>';
  }
}
