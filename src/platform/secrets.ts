import { isTauri } from '@/lib/platform';
import { storageGet, storageRemove } from '@/lib/persistentStore';

/**
 * Secret storage, separate from the app's shared settings store.
 *
 * `persistentStore` loads all of `app-settings.json` into an in-memory cache
 * and writes it to disk in plaintext, so TOTP seeds, tokens and passwords
 * must not live there.
 *
 * - In Tauri: the encrypted Rust vault (`src-tauri/src/secrets_vault.rs`),
 *   AES-256-GCM with the key in the OS keychain. Per-plugin separation is
 *   enforced only by sdk.ts: any webview code can call `secret_vault_*`
 *   directly. Without a keychain the key file lives in app data, which the
 *   webview's fs scope can read.
 * - On the web (`npm run dev`): `sessionStorage`, not `localStorage`, because
 *   the web build mirrors `localStorage` into the shared cache. Secrets last
 *   for the session only; the web build is for development.
 *
 * Without a keychain the vault key falls back to a 0600 file; `vaultStatus()`
 * reports which mode is active so Settings can show it.
 */

const LEGACY_STORE_FILE = 'secrets.json';
const WEB_PREFIX = 'devtool-secret:';

/** Where the key comes from; see `KeyMode` in secrets_vault.rs. */
export type VaultKeyMode = 'keychain' | 'file';

export interface VaultStatus {
  encrypted: boolean;
  keyMode: VaultKeyMode;
  /** `false` when data exists but the current key cannot decrypt it. */
  readable: boolean;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Vault key `<pluginId>/<key>`. Deliberately unlike the shared store's
 *  `devtool:` prefix, so a key copied to the wrong store stands out. */
export function vaultKey(pluginId: string, key: string): string {
  return `${pluginId}/${key}`;
}

export async function secretGet(pluginId: string, key: string): Promise<string | null> {
  const k = vaultKey(pluginId, key);
  if (!isTauri) return sessionStorage.getItem(WEB_PREFIX + k);
  return (await call<string | null>('secret_vault_get', { key: k })) ?? null;
}

export async function secretSet(pluginId: string, key: string, value: string): Promise<void> {
  const k = vaultKey(pluginId, key);
  if (!isTauri) {
    sessionStorage.setItem(WEB_PREFIX + k, value);
    return;
  }
  await call<void>('secret_vault_set', { key: k, value });
}

export async function secretDelete(pluginId: string, key: string): Promise<void> {
  const k = vaultKey(pluginId, key);
  if (!isTauri) {
    sessionStorage.removeItem(WEB_PREFIX + k);
    return;
  }
  await call<void>('secret_vault_delete', { key: k });
}

/** Key names (without the plugin prefix) this plugin holds. */
export async function secretKeys(pluginId: string): Promise<string[]> {
  const prefix = `${pluginId}/`;
  const all = isTauri
    ? await call<string[]>('secret_vault_keys')
    : Object.keys(sessionStorage)
        .filter((k) => k.startsWith(WEB_PREFIX))
        .map((k) => k.slice(WEB_PREFIX.length));
  return all
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort();
}

/** Current key mode, so Settings can state the protection in effect. */
export async function vaultStatus(): Promise<VaultStatus | null> {
  if (!isTauri) return null;
  const raw = await call<{ encrypted: boolean; key_mode: VaultKeyMode; readable: boolean }>(
    'secret_vault_status',
  );
  return { encrypted: raw.encrypted, keyMode: raw.key_mode, readable: raw.readable };
}

/** No-op: the vault writes to disk on every command. Kept as the call site
 *  used by the migration flow. */
export async function flushSecrets(): Promise<void> {}

/** Empties the vault. Used by main.tsx's dev reset alongside
 *  `clearPersistentStore()`. */
export async function clearSecrets(): Promise<void> {
  if (!isTauri) {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(WEB_PREFIX)) sessionStorage.removeItem(k);
    }
    return;
  }
  await call<void>('secret_vault_clear');
}

/**
 * Shared-store keys that actually hold secrets, and where they belong.
 * Listed explicitly: matching on names like "secret" would miss some keys
 * and catch user input fields.
 */
const MIGRATIONS: ReadonlyArray<{ from: string; pluginId: string; key: string }> = [
  // TOTP/HOTP seeds: enough to generate the user's login codes.
  { from: 'devtool:2fa:accounts', pluginId: '2fa', key: 'accounts' },
  // Tokens pasted into the JWT debugger are usually real bearer tokens.
  { from: 'devtool:jwt:token', pluginId: 'jwt', key: 'token' },
  // The API Client vault exists to hold values kept out of environments.
  { from: 'devtool:apiclient:vault', pluginId: 'api-client', key: 'vault' },
];

/**
 * Moves secrets from the shared store into the vault at startup. The source
 * is deleted after each successful copy, so re-running is a no-op and an
 * interrupted run resumes next time; no "migrated" flag is needed.
 */
export async function migrateSecretsFromSharedStore(): Promise<string[]> {
  // Not on the web: the web vault is sessionStorage, so "moving" would
  // delete persistent data. It stays in place until the desktop app
  // migrates it.
  if (!isTauri) return [];

  const moved: string[] = [];
  for (const { from, pluginId, key } of MIGRATIONS) {
    const raw = storageGet(from);
    if (raw === null) continue;
    await secretSet(pluginId, key, raw);
    storageRemove(from);
    moved.push(from);
  }
  if (moved.length > 0) await flushSecrets();
  return moved;
}

/**
 * Moves secrets from the earlier unencrypted `secrets.json` (tauri-plugin-
 * store) into the encrypted vault, then clears the old store. A no-op for
 * new installs.
 */
export async function migrateSecretsFromPlainStore(): Promise<number> {
  // Same reason as above; the plain store only existed in Tauri builds.
  if (!isTauri) return 0;
  let moved = 0;
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    const legacy = await load(LEGACY_STORE_FILE, { defaults: {}, autoSave: false });
    const entries = await legacy.entries<string>();
    for (const [key, value] of entries) {
      if (typeof value !== 'string') continue;
      await call<void>('secret_vault_set', { key, value });
      moved += 1;
    }
    if (moved > 0) {
      await legacy.clear();
      await legacy.save();
    }
  } catch {
    // No legacy file, or the store plugin failed to open it: nothing to move.
  }
  return moved;
}

/** Test hook; there is no module state left to reset. */
export function __resetSecretsForTest(): void {}
