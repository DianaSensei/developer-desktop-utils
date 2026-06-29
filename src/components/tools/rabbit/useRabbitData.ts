import { useEffect, useState } from 'react';

interface RabbitDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads an async resource, tracking loading/error state and ignoring results
 * from a stale request when deps change (or the component unmounts). `deps`
 * should include the connection id and the shared `refreshKey`.
 */
export function useRabbitData<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): RabbitDataState<T> & { reload: () => void } {
  const [state, setState] = useState<RabbitDataState<T>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => { if (alive) setState({ data, loading: false, error: null }); })
      .catch((e) => {
        if (alive) setState({ data: null, loading: false, error: String(e instanceof Error ? e.message : e) });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
