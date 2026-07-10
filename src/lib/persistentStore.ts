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
const THEME_MIGRATION_FLAG = '__migratedThemeKey_v1';
const OLD_DARK_MODE_KEY = 'devtool-dark-mode';
const THEME_KEY = 'devtool-theme';
const THEME_SHADOW_KEY = 'devtool-theme-shadow';

export type ThemePreference = 'light' | 'dark' | 'system';
const VALID_THEME_VALUES: ThemePreference[] = ['light', 'dark', 'system'];

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

// One-time migration of the old boolean `devtool-dark-mode` key into the new
// 3-state `devtool-theme` key. Independent of MIGRATION_FLAG (which tracks
// the earlier localStorage -> Tauri store migration, already complete by
// the time this app-level feature migration ships).
async function migrateThemeKey(s: Store): Promise<void> {
  if (await s.get(THEME_MIGRATION_FLAG)) return;

  const old = cache.get(OLD_DARK_MODE_KEY);
  const mapped: ThemePreference =
    old === 'true' ? 'dark' : old === 'false' ? 'light' : 'system';

  const existing = cache.get(THEME_KEY);
  const alreadyValid =
    typeof existing === 'string' &&
    (VALID_THEME_VALUES as string[]).includes(existing);

  if (!alreadyValid) {
    setThemePreference(mapped);
  }

  storageRemove(OLD_DARK_MODE_KEY);

  await s.set(THEME_MIGRATION_FLAG, true);
  await s.save();
}

export async function initPersistentStore(): Promise<void> {
  const s = await load(STORE_FILE, { defaults: {}, autoSave: 100 });
  store = s;
  await migrateFromLocalStorage(s);

  const entries = await s.entries<string>();
  for (const [key, value] of entries) {
    if (key === MIGRATION_FLAG || key === THEME_MIGRATION_FLAG) continue;
    if (typeof value === 'string') cache.set(key, value);
  }

  await migrateThemeKey(s);
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

// --- Theme preference (single source of truth: `devtool-theme`) ---
//
// All reads/writes of the theme preference MUST go through these two
// wrappers — never call storageGet/storageSet('devtool-theme', ...) directly
// elsewhere. setThemePreference also mirrors the value into a plain
// localStorage key (`devtool-theme-shadow`) so index.html's pre-React
// bootstrap script can apply the right theme class before first paint
// without needing to touch the async Tauri store. That shadow key is
// write-only from every module except the bootstrap script, which only reads it.

export function setThemePreference(value: ThemePreference): void {
  if (!VALID_THEME_VALUES.includes(value)) {
    throw new Error(`Invalid theme preference: ${value}`);
  }
  storageSet(THEME_KEY, value);
  try {
    localStorage.setItem(THEME_SHADOW_KEY, value);
  } catch {
    // localStorage may be unavailable (e.g. some test/SSR environments) —
    // the Tauri store write above is the source of truth regardless.
  }
}

export function getThemePreference(): ThemePreference {
  const raw = storageGet(THEME_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  // Corrupt or missing value — self-heal by writing back a valid default.
  setThemePreference('system');
  return 'system';
}
