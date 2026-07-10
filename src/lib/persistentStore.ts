// Native (Tauri-side) replacement for the webview's localStorage.
//
// @tauri-apps/plugin-store's JS API is entirely async, but most of the app
// (usePersistentState + a handful of direct call sites) expects synchronous
// reads/writes, matching localStorage's contract, so there's no loading
// flicker on first render. The fix: load the whole store into an in-memory
// string cache once at boot (see initPersistentStore, awaited in main.tsx
// before the app's module graph is even evaluated), then serve every read
// from that cache. Writes update the cache synchronously and persist to disk
// in the background via the store's autoSave debounce, with an explicit
// flush on app hide/close.
//
// Every key/value is treated as an opaque string, exactly like localStorage,
// so existing JSON.parse/JSON.stringify call sites need no changes.

import { load, type Store } from '@tauri-apps/plugin-store';

const STORE_FILE = 'app-settings.json';
const MIGRATION_FLAG = '__migratedFromLocalStorage';

let store: Store | null = null;
const cache = new Map<string, string>();

async function migrateFromLocalStorage(s: Store): Promise<void> {
  if (await s.get(MIGRATION_FLAG)) return;

  const keys = Object.keys(localStorage).filter(
    (k) => k.startsWith('devtool-') || k.startsWith('devtool:')
  );
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value === null) continue;
    cache.set(key, value);
    await s.set(key, value);
  }
  await s.set(MIGRATION_FLAG, true);
  await s.save();
  for (const key of keys) localStorage.removeItem(key);
}

export async function initPersistentStore(): Promise<void> {
  const s = await load(STORE_FILE, { defaults: {}, autoSave: 100 });
  store = s;
  await migrateFromLocalStorage(s);

  const entries = await s.entries<string>();
  for (const [key, value] of entries) {
    if (key === MIGRATION_FLAG) continue;
    if (typeof value === 'string') cache.set(key, value);
  }
}

export function storageGet(key: string): string | null {
  return cache.has(key) ? cache.get(key)! : null;
}

export function storageSet(key: string, value: string): void {
  cache.set(key, value);
  void store?.set(key, value);
}

export function storageRemove(key: string): void {
  cache.delete(key);
  void store?.delete(key);
}

export async function flushPersistentStore(): Promise<void> {
  await store?.save();
}

export async function clearPersistentStore(): Promise<void> {
  cache.clear();
  await store?.clear();
  await store?.save();
}
