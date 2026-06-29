import { useEffect, useRef, useState } from 'react';

interface RabbitDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Stale-while-revalidate cache (module scope, app-session lived). Switching nav
// tabs unmounts/remounts views, so without this every tab click re-fetches from
// scratch and flashes a loading spinner. Keyed by the serialized deps (which
// include the connection id and refreshKey), so a manual Refresh — which bumps
// refreshKey — is a cache miss and does show the spinner, as expected.
const cache = new Map<string, unknown>();
const CACHE_CAP = 100;

function cacheSet(key: string, value: unknown) {
  if (cache.size >= CACHE_CAP && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/**
 * Loads an async resource, tracking loading/error state and ignoring results
 * from a stale request when deps change (or the component unmounts). `deps`
 * should include the connection id and the shared `refreshKey`.
 *
 * Load-once: a resource that's already been fetched for the same deps is shown
 * from cache and is NOT silently re-fetched on revisit — navigating away and back
 * shows the last result without a new request. A fresh load happens only on a
 * cache miss (e.g. a manual Refresh bumps `refreshKey`, which changes the deps) or
 * an explicit `reload()`.
 */
export function useRabbitData<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): RabbitDataState<T> & { reload: () => void } {
  // Key by call site (loader source) + deps. Different views often share the same
  // deps (e.g. [conn.id, refreshKey]) but return different shapes, so deps alone
  // would collide and hand one view another's data.
  const cacheKey = `${loader.toString()}|${JSON.stringify(deps)}`;
  const [state, setState] = useState<RabbitDataState<T>>(() =>
    cache.has(cacheKey)
      ? { data: cache.get(cacheKey) as T, loading: false, error: null }
      : { data: null, loading: true, error: null },
  );
  const [tick, setTick] = useState(0);
  const prevKey = useRef<string | null>(null);
  const prevTick = useRef(tick);

  useEffect(() => {
    const keyChanged = prevKey.current !== cacheKey;
    const manualReload = prevTick.current !== tick && !keyChanged;
    prevKey.current = cacheKey;
    prevTick.current = tick;

    // Already loaded for these deps and not an explicit reload → serve the cached
    // result and don't hit the broker again. The user refreshes manually later.
    if (cache.has(cacheKey) && !manualReload) {
      setState({ data: cache.get(cacheKey) as T, loading: false, error: null });
      return;
    }

    let alive = true;
    // Keep showing prior data (no spinner) while a cache-miss/manual reload runs;
    // only spin when there's nothing to show yet.
    setState((s) => (s.data !== null ? { ...s, error: null } : { data: null, loading: true, error: null }));
    loader()
      .then((data) => { if (alive) { cacheSet(cacheKey, data); setState({ data, loading: false, error: null }); } })
      .catch((e) => {
        if (alive) setState({ data: null, loading: false, error: String(e instanceof Error ? e.message : e) });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
