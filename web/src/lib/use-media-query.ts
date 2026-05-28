import { useSyncExternalStore } from 'react';

function subscribeMediaQuery(query: string, onStoreChange: () => void): () => void {
  const mq = globalThis.matchMedia(query);
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

function getMediaQuerySnapshot(query: string): boolean {
  return globalThis.matchMedia(query).matches;
}

/**
 * Subscribe to a CSS media query without mount-only `useEffect` sync.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (onStoreChange) => subscribeMediaQuery(query, onStoreChange),
    () => getMediaQuerySnapshot(query),
    () => serverDefault,
  );
}
