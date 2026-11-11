import { useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  retry: () => void;
}

/** Runs `fn` whenever `deps` change. Ignores results from superseded runs, and drops the old data
 *  while the new run is pending, so callers never mix results from different inputs. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'retry'>>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    let current = true;
    setState({ data: null, error: null, loading: true });
    fn().then(
      data => current && setState({ data, error: null, loading: false }),
      (e: unknown) => current && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { ...state, retry };
}
