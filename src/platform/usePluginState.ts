import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import type { PluginSdk } from './sdk';

interface Options {
  /** Write debounce in ms, as in `usePersistentState`. */
  debounceMs?: number;
  /**
   * Full key this tool used before moving to the SDK. Historical prefixes
   * often differ from the plugin id (`devtool:apiclient:*` vs `api-client`),
   * so without it users would lose their saved data. Migrated once, only if
   * the new key is empty.
   */
  legacyKey?: string;
}

/**
 * Moves a value from a legacy key to the plugin's namespaced key, once and
 * only if the new key is empty. Exported for module-scope stores that use
 * `sdk.storage` directly.
 */
export function migrateLegacyKey(sdk: PluginSdk, key: string, legacyKey: string): void {
  const full = sdk.storage.key(key);
  if (legacyKey === full) return;
  if (sdk.storage.get(key) !== null) return;

  const old = storageGet(legacyKey);
  if (old === null) return;
  // Copy the stored string as is; no parse/stringify round trip.
  storageSet(full, old);
  storageRemove(legacyKey);
}

/**
 * `usePersistentState` with a plugin-namespaced key and a `storage`
 * permission check. Same behavior otherwise: synchronous initial read,
 * debounced writes, flush on hide/close.
 *
 * Audits once per key at mount rather than per write, so typing does not
 * flood the 500-entry audit buffer.
 */
export function usePluginState<T>(
  sdk: PluginSdk,
  key: string,
  initial: T | (() => T),
  options?: Options,
): [T, Dispatch<SetStateAction<T>>] {
  const namespaced = useMemo(() => {
    // Checks the permission and records one audit entry for this key.
    sdk.storage.get(key);
    if (options?.legacyKey) migrateLegacyKey(sdk, key, options.legacyKey);
    return sdk.storage.key(key);
    // `options.legacyKey` is intentionally not a dependency: migration
    // runs once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, key]);

  return usePersistentState<T>(namespaced, initial, options);
}
