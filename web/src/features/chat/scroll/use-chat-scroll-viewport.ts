import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import {
  isNearChatBottom,
  scrollChatToEnd,
} from '@/features/chat/scroll/chat-scroll-geometry';
import type { Message } from '@/features/chat/messages/messages.types';

/** WebKit/Chromium: wheel deltas flipped relative to device default (e.g. some mice on macOS). */
function wheelDeltaImpliesTowardOlderMessages(e: WheelEvent): boolean {
  const wk = e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean };
  if (wk.webkitDirectionInvertedFromDevice === true) {
    return e.deltaY > 0;
  }
  return e.deltaY < 0;
}

export interface UseChatScrollViewportArgs {
  hasToken: boolean;
  showSessionLoading: boolean;
  conversationId: string | null;
  chatMessages: Message[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreMessages: () => void | Promise<void>;
}

export interface UseChatScrollViewportResult {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** True when the viewport is within the near-bottom threshold, including non-overflowing content. */
  atBottom: boolean;
  registerListContentRef: (el: HTMLDivElement | null) => void;
  scrollToBottom: (smooth?: boolean) => void;
  onScroll: () => void;
}

/**
 * Cursor-style chat scroll: one container, one “following tail” flag, one scrollToEnd path.
 *
 * - **Following**: content growth (streaming, new rows) keeps the tail in view.
 * - **Not following**: user scrolled up — never programmatic scroll until they return.
 * - **Force to end**: session open/switch, scroll-to-bottom button.
 *
 * Virtual list scroll hacks are intentionally avoided — `MessageList` is a plain column.
 */
export function useChatScrollViewport({
  hasToken,
  showSessionLoading,
  conversationId,
  chatMessages,
  hasMore,
  loadingMore,
  loadMoreMessages,
}: UseChatScrollViewportArgs): UseChatScrollViewportResult {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [atBottom, setAtBottom] = useState(true);

  const prevLoadingRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const listScrollMetricsRef = useRef<{
    first: Message | undefined;
    len: number;
    scrollHeight: number;
  }>({ first: undefined, len: 0, scrollHeight: 0 });

  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
  }, []);

  const scrollToEnd = useCallback(
    (opts?: { force?: boolean; smooth?: boolean }) => {
      const el = scrollRef.current;
      if (!el) return;
      if (!opts?.force && !followingRef.current) return;

      if (opts?.force) {
        setFollowing(true);
      }

      if (opts?.smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        return;
      }

      scrollChatToEnd(el);
      setAtBottom(isNearChatBottom(el));
    },
    [setFollowing],
  );

  const stopFollowing = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    // Input intent pauses auto-follow before scrolling, but does not imply a
    // change in position (the gesture may be consumed by a nested scroll area).
    setFollowing(false);
    setAtBottom(isNearChatBottom(el));
  }, [setFollowing]);

  const onResize = useCallback(() => {
    scrollToEnd();
    const el = scrollRef.current;
    if (!el) return;
    // Resizing the composer or keyboard must not re-enable following for history readers.
    setAtBottom(isNearChatBottom(el));
  }, [scrollToEnd]);

  const registerListContentRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (listContentRef.current === el) return;

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      listContentRef.current = el;

      if (!el) return;

      // Correct the tail before paint and remeasure after rows grow or collapse.
      const ro = new ResizeObserver(onResize);
      ro.observe(el);
      resizeObserverRef.current = ro;
    },
    [onResize],
  );

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const near = isNearChatBottom(el);
    setFollowing(near);
    setAtBottom(near);

    if (el.scrollTop < 100 && !near && hasMore && !loadingMore) {
      void loadMoreMessages();
    }
  }, [setFollowing, hasMore, loadingMore, loadMoreMessages]);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      scrollToEnd({ force: true, smooth });
    },
    [scrollToEnd],
  );

  useLayoutEffect(() => {
    if (!hasToken) return;
    if (showSessionLoading) {
      prevLoadingRef.current = true;
      return;
    }
    if (prevLoadingRef.current !== true) return;
    prevLoadingRef.current = false;
    setFollowing(true);
    scrollToEnd({ force: true });
  }, [showSessionLoading, hasToken, setFollowing, scrollToEnd]);

  useLayoutEffect(() => {
    if (!hasToken || showSessionLoading) return;
    listScrollMetricsRef.current = { first: undefined, len: 0, scrollHeight: 0 };
    prevMessageCountRef.current = 0;
    setFollowing(true);
    scrollToEnd({ force: true });
  }, [conversationId, hasToken, showSessionLoading, setFollowing, scrollToEnd]);

  useLayoutEffect(() => {
    if (showSessionLoading) return;

    const count = chatMessages.length;
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = count;

    if (count > prevCount && followingRef.current) {
      scrollToEnd();
    }
  }, [chatMessages.length, showSessionLoading, scrollToEnd]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || showSessionLoading) return;

    const prev = listScrollMetricsRef.current;
    const first = chatMessages[0];
    const len = chatMessages.length;
    const newHeight = el.scrollHeight;
    const prepended = len > prev.len && prev.len > 0 && first !== undefined && first !== prev.first;

    if (prepended && prev.scrollHeight > 0) {
      el.scrollTop += newHeight - prev.scrollHeight;
    }

    listScrollMetricsRef.current = { first, len, scrollHeight: newHeight };
  }, [chatMessages, showSessionLoading]);

  useLayoutEffect(() => {
    if (!hasToken || showSessionLoading) return;
    const root = scrollRef.current;
    if (!root) return;

    const viewportObserver = new ResizeObserver(onResize);
    viewportObserver.observe(root);

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (Math.abs(e.deltaY) < 0.25) return;
      if (wheelDeltaImpliesTowardOlderMessages(e)) {
        stopFollowing();
      }
    };

    let touchLastY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) touchLastY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = y - touchLastY;
      touchLastY = y;
      if (dy > 2) stopFollowing();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const scrollbarWidth = root.offsetWidth - root.clientWidth;
      if (scrollbarWidth <= 0) return;
      const rect = root.getBoundingClientRect();
      if (e.clientX >= rect.right - scrollbarWidth) {
        stopFollowing();
      }
    };

    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      viewportObserver.disconnect();
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
    };
  }, [hasToken, showSessionLoading, stopFollowing, onResize]);

  return {
    scrollRef,
    atBottom,
    registerListContentRef,
    scrollToBottom,
    onScroll,
  };
}
