import { useEffect, useRef, useState } from 'react';

interface RedisDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Stale-while-revalidate cache (module scope), same pattern as RabbitMQ's
// useRabbitData — switching nav tabs unmounts/remounts views, so without this
// every tab click re-fetches from scratch and flashes a loading spinner.
const cache = new Map<string, unknown>();
const CACHE_CAP = 100;

function cacheSet(key: string, value: unknown) {
  if (cache.size >= CACHE_CAP && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

export function useRedisData<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): RedisDataState<T> & { reload: () => void } {
  const cacheKey = `${loader.toString()}|${JSON.stringify(deps)}`;
  const [state, setState] = useState<RedisDataState<T>>(() =>
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

    if (cache.has(cacheKey) && !manualReload) {
      setState({ data: cache.get(cacheKey) as T, loading: false, error: null });
      return;
    }

    let alive = true;
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
