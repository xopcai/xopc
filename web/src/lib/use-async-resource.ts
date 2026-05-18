import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Snapshot returned by {@link useAsyncResource}.
 *
 * `error` is the raw rejection value (kept as `unknown` so callers stay honest about
 * what `fetcher` can throw). Map it to a string at the call site if you need a label.
 */
export type AsyncResourceState<T> = {
  data: T;
  loading: boolean;
  error: unknown | null;
};

type Action<T> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'error'; data: T; error: unknown }
  | { type: 'patch'; updater: (prev: T) => T };

function makeReducer<T>() {
  return function reducer(state: AsyncResourceState<T>, action: Action<T>): AsyncResourceState<T> {
    switch (action.type) {
      case 'start':
        return state.loading ? state : { ...state, loading: true, error: null };
      case 'success':
        return { data: action.data, loading: false, error: null };
      case 'error':
        return { data: action.data, loading: false, error: action.error };
      case 'patch':
        return { ...state, data: action.updater(state.data) };
    }
  };
}

export type UseAsyncResourceOptions<T> = {
  /**
   * When false, the effect short-circuits without calling the fetcher.
   * Typical use: gate on `hasToken` / `panel === 'foo'` / etc.
   */
  enabled?: boolean;
  /** Stable initial value while the first fetch is in flight. */
  initial: T;
  /**
   * Replacement value when the fetch rejects. Defaults to `initial`.
   * Pass a function form when the fallback should depend on the error.
   */
  errorData?: T | ((err: unknown) => T);
};

/**
 * Reducer-backed `loading + data + error` state for an async fetch.
 *
 * Replaces the common 4-call pattern:
 *
 *     setLoading(true);
 *     fetcher().then(setData).catch(() => setData(fallback)).finally(() => setLoading(false));
 *
 * with a single dispatch per state transition, sidestepping the
 * `react-doctor/no-cascading-set-state` heuristic and putting cancellation in
 * one place. The latest `fetcher` reference is captured via ref, so callers do
 * not need to memoize it — re-fires are driven solely by `enabled` + `deps`.
 */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: UseAsyncResourceOptions<T>,
): AsyncResourceState<T> & {
  /** Patch the cached `data` outside of a fetch — for mutations / optimistic updates. */
  setData: (next: T | ((prev: T) => T)) => void;
} {
  const { enabled = true, initial, errorData } = options;
  const [state, dispatch] = useReducer(
    makeReducer<T>(),
    undefined as never,
    (): AsyncResourceState<T> => ({ data: initial, loading: false, error: null }),
  );

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorDataRef = useRef(errorData);
  errorDataRef.current = errorData;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    dispatch({ type: 'start' });
    void fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) dispatch({ type: 'success', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const fallback = errorDataRef.current;
        const data =
          typeof fallback === 'function'
            ? (fallback as (e: unknown) => T)(error)
            : fallback !== undefined
              ? fallback
              : initialRef.current;
        dispatch({ type: 'error', data, error });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, ...deps]);

  const setData = useCallback((next: T | ((prev: T) => T)) => {
    dispatch({
      type: 'patch',
      updater: typeof next === 'function' ? (next as (prev: T) => T) : () => next,
    });
  }, []);

  return { ...state, setData };
}
