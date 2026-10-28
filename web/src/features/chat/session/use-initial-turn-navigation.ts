import { useEffect, useRef } from 'react';

/** Reveal a persisted turn by identity, loading older pages when necessary. */
export function useInitialTurnNavigation({ conversationId, turnId, messages, ready, hasMore, loadingMore, loadMore, reveal, onLocated }: {
  conversationId?: string | null; turnId?: string; messages: readonly { turnId?: string }[]; ready: boolean;
  hasMore: boolean; loadingMore: boolean; loadMore: () => Promise<unknown>;
  reveal: (index: number) => boolean; onLocated?: (found: boolean) => void;
}) {
  const progress = useRef({ key: '', finished: false, requestedLength: -1 });
  useEffect(() => {
    const key = `${conversationId ?? ''}:${turnId ?? ''}`;
    if (progress.current.key !== key) progress.current = { key, finished: false, requestedLength: -1 };
    if (!turnId || !ready || progress.current.finished) return;
    const search = progress.current;
    const index = messages.findIndex(message => message.turnId === turnId);
    if (index >= 0) {
      let frame = 0;
      let cancelled = false;
      let attempts = 0;
      const locate = () => {
        if (cancelled) return;
        if (progress.current !== search) return;
        if (reveal(index)) { search.finished = true; onLocated?.(true); }
        else if (++attempts < 3) frame = requestAnimationFrame(locate);
        else { search.finished = true; onLocated?.(false); }
      };
      frame = requestAnimationFrame(locate);
      return () => { cancelled = true; cancelAnimationFrame(frame); };
    }
    if (loadingMore) return;
    if (!hasMore || progress.current.requestedLength === messages.length) {
      progress.current.finished = true;
      onLocated?.(false);
      return;
    }
    // A failed/empty page must not cause an unbounded retry loop.
    progress.current.requestedLength = messages.length;
    void loadMore().catch(() => {
      if (progress.current !== search) return;
      search.finished = true; onLocated?.(false);
    });
  }, [conversationId, turnId, messages, ready, hasMore, loadingMore, loadMore, reveal, onLocated]);
}
