import { useCallback, useRef } from 'react';

/**
 * FlatList fires `onEndReached` on mount when content is shorter than the viewport.
 * Pair with `onMomentumScrollBegin` so pagination only runs after the user scrolls.
 */
export function useFlatListEndReached(onLoadMore: () => void) {
  const blockedRef = useRef(true);

  const onEndReached = useCallback(() => {
    if (blockedRef.current) return;
    blockedRef.current = true;
    onLoadMore();
  }, [onLoadMore]);

  const onMomentumScrollBegin = useCallback(() => {
    blockedRef.current = false;
  }, []);

  return { onEndReached, onMomentumScrollBegin };
}
