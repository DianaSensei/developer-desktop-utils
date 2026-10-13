import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PluginSdk } from './sdk';

/**
 * `usePersistentState` for sensitive values, backed by the secret vault
 * (secrets.ts).
 *
 * The vault is asynchronous, so the first render has no data. The hook
 * returns a `ready` flag and writes nothing until the read finishes;
 * otherwise the initial value would overwrite the stored data.
 */
export function useSecretState<T>(
  sdk: PluginSdk,
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [state, setState] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await sdk.secrets.get(key);
        if (cancelled) return;
        if (raw !== null) {
          try {
            setState(JSON.parse(raw) as T);
          } catch {
            // Keep the unreadable value under another key before it can be
            // overwritten, so it can still be recovered by hand.
            await sdk.secrets.set(`${key}.corrupt`, raw);
            sdk.log('secret-corrupt', key);
          }
        }
      } catch {
        // Missing permission or vault unavailable: keep the initial value.
        // The SDK has already recorded it in the audit log.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk, key]);

  useEffect(() => {
    if (!ready) return;
    void sdk.secrets.set(key, JSON.stringify(stateRef.current)).catch(() => {
      // Already recorded in the audit log by the SDK.
    });
  }, [state, ready, sdk, key]);

  const set = useCallback<Dispatch<SetStateAction<T>>>((value) => setState(value), []);

  return [state, set, ready];
}
