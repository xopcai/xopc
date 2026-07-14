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
  sessionKey: string | null;
  sending: boolean;
  chatMessages: Message[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreMessages: () => void | Promise<void>;
}

export interface UseChatScrollViewportResult {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** True while auto-following the transcript tail (hides scroll-to-bottom affordance). */
  atBottom: boolean;
  registerListContentRef: (el: HTMLDivElement | null) => void;
  scrollToBottom: (smooth?: boolean) => void;
  onScroll: () => void;
}

/**
 * Cursor-style chat scroll: one container, one “following tail” flag, one scrollToEnd path.
 *
 * - **Following**: content growth (streaming, new rows) keeps the tail in view.
 * - **Not following**: user scrolled up — never programmatic scroll until they return or send.
 * - **Force to end**: send message, session open/switch, scroll-to-bottom button.
 *
 * Virtual list scroll hacks are intentionally avoided — `MessageList` is a plain column.
 */
export function useChatScrollViewport({
  hasToken,
  showSessionLoading,
  sessionKey,
  sending,
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
  const prevSendingRef = useRef(false);
  const prevMessageCountRef = useRef(0);

  const listScrollMetricsRef = useRef<{
    first: Message | undefined;
    len: number;
    scrollHeight: number;
  }>({ first: undefined, len: 0, scrollHeight: 0 });

  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
    setAtBottom((prev) => (prev === next ? prev : next));
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
    },
    [setFollowing],
  );

  const stopFollowing = useCallback(() => {
    setFollowing(false);
  }, [setFollowing]);

  const registerListContentRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (listContentRef.current === el) return;

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      listContentRef.current = el;

      if (!el) return;

      const ro = new ResizeObserver(() => {
        // ResizeObserver runs before paint. Correct the tail position here so a
        // growing streaming row never paints one frame at the stale scrollTop.
        scrollToEnd();
      });
      ro.observe(el);
      resizeObserverRef.current = ro;
    },
    [scrollToEnd],
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
  }, [sessionKey, hasToken, showSessionLoading, setFollowing, scrollToEnd]);

  const sendingStarted = hasToken && sending && !prevSendingRef.current && !showSessionLoading;
  useLayoutEffect(() => {
    prevSendingRef.current = sending;
    if (!sendingStarted) return;
    setFollowing(true);
    scrollToEnd({ force: true });
  }, [sendingStarted, sending, setFollowing, scrollToEnd]);

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
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
    };
  }, [hasToken, showSessionLoading, stopFollowing]);

  return {
    scrollRef,
    atBottom,
    registerListContentRef,
    scrollToBottom,
    onScroll,
  };
}
