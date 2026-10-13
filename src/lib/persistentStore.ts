// Tauri-backed replacement for localStorage with the same synchronous API.
//
// The store plugin is async, but usePersistentState and other callers read
// synchronously, so the whole store is loaded into an in-memory string cache
// at boot (initPersistentStore, awaited in main.tsx) and every read is served
// from it. Writes update the cache immediately and are saved by the store's
// autoSave debounce, with an explicit flush when the app is hidden or closed.
// Values are opaque strings, as with localStorage.

import { load, type Store } from '@tauri-apps/plugin-store';
import { isTauri } from '@/lib/platform';

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

// Set once at the end of initPersistentStore, before any provider writes
// its defaults: `true` means the store was empty at boot (a new install).
let freshInstall = false;

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

// One-time migration of the boolean `devtool-dark-mode` key to the
// three-state `devtool-theme` key.
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
  // Web build: no Tauri IPC, and localStorage already works, so load it
  // into the cache and skip the store migrations.
  if (!isTauri) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) cache.set(key, value);
    }
    freshInstall = cache.size === 0;
    return;
  }

  const s = await load(STORE_FILE, { defaults: {}, autoSave: 100 });
  store = s;
  await migrateFromLocalStorage(s);

  const entries = await s.entries<string>();
  for (const [key, value] of entries) {
    if (key === MIGRATION_FLAG || key === THEME_MIGRATION_FLAG) continue;
    if (typeof value === 'string') cache.set(key, value);
  }

  freshInstall = cache.size === 0;

  await migrateThemeKey(s);
}

// True only for a new install. Use it for one-time defaults (onboarding,
// tool intros) so upgrades do not re-trigger first-run behavior.
export function wasFreshInstall(): boolean {
  return freshInstall;
}

/** Every key currently in the store (e.g. to clear one plugin's namespace). */
export function storageKeys(): string[] {
  return [...cache.keys()];
}

export function storageGet(key: string): string | null {
  return cache.has(key) ? cache.get(key)! : null;
}

export function storageSet(key: string, value: string): void {
  cache.set(key, value);
  if (isTauri) void store?.set(key, value);
  else try { localStorage.setItem(key, value); } catch { /* unavailable — cache is still authoritative for this session */ }
}

export function storageRemove(key: string): void {
  cache.delete(key);
  if (isTauri) void store?.delete(key);
  else try { localStorage.removeItem(key); } catch { /* unavailable */ }
}

export async function flushPersistentStore(): Promise<void> {
  if (isTauri) await store?.save();
  // Web: storageSet already writes localStorage synchronously — nothing to flush.
}

export async function clearPersistentStore(): Promise<void> {
  cache.clear();
  if (isTauri) {
    await store?.clear();
    await store?.save();
  } else {
    try { localStorage.clear(); } catch { /* unavailable */ }
  }
}

// --- Theme preference (`devtool-theme`) ---
//
// Always use these two functions. setThemePreference also mirrors the value
// to localStorage (`devtool-theme-shadow`) so index.html's pre-React script
// can apply the theme before first paint; only that script reads the shadow.

export function setThemePreference(value: ThemePreference): void {
  if (!VALID_THEME_VALUES.includes(value)) {
    throw new Error(`Invalid theme preference: ${value}`);
  }
  storageSet(THEME_KEY, value);
  try {
    localStorage.setItem(THEME_SHADOW_KEY, value);
  } catch {
    // localStorage may be unavailable (some test environments); the store
    // write above is authoritative.
  }
}

export function getThemePreference(): ThemePreference {
  const raw = storageGet(THEME_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  // Missing or invalid value: write back a valid default.
  setThemePreference('system');
  return 'system';
}
