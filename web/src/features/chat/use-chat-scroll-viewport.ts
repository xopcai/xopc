import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';

import {
  CHAT_SCROLL_REPIN_WITHIN_PX,
  CHAT_SCROLL_UNPIN_BEYOND_PX,
  chatScrollDistanceFromBottom,
} from '@/features/chat/chat-scroll-geometry';
import type { Message } from '@/features/chat/messages.types';

const WHEEL_SCROLL_TOP_EPS = 0.5;
const WHEEL_FROM_BOTTOM_EPS = 0.75;

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
  /** When this changes (after navigation), pin to bottom and force-scroll — prior session may have been mid-scroll. */
  sessionKey: string | null;
  sending: boolean;
  chatMessages: Message[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreMessages: () => void | Promise<void>;
}

export interface UseChatScrollViewportResult {
  scrollRef: RefObject<HTMLDivElement | null>;
  atBottom: boolean;
  /** @param smooth Animate scroll when true. @param force When true, ignore "reading history" geometry (e.g. explicit scroll-to-bottom). */
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;
  onScroll: () => void;
}

/**
 * Scroll viewport for `ChatPage` message column: pin-to-bottom, prepend anchor, infinite scroll-up.
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
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  /** Tracks loading→idle so we scroll to bottom once after refresh / session load. */
  const prevLoadingRef = useRef(true);

  /** After prepending older messages, preserve viewport (virtual + non-virtual lists). */
  const listScrollMetricsRef = useRef<{
    first: Message | undefined;
    len: number;
    scrollHeight: number;
  }>({ first: undefined, len: 0, scrollHeight: 0 });

  /** Coalesce pinned follow-scroll to one rAF per burst (many SSE updates per frame). */
  const followTailRafRef = useRef<number | null>(null);

  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  const scrollToBottom = useCallback((smooth = true, force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = chatScrollDistanceFromBottom(el);
    if (!force && fromBottom > CHAT_SCROLL_UNPIN_BEYOND_PX + 1) {
      if (atBottomRef.current) {
        atBottomRef.current = false;
        setAtBottom(false);
      }
      return;
    }
    /** Instant follow-the-tail: avoid waiting a frame when transcript/virtual height grows (streaming). */
    if (force && !smooth) {
      el.scrollTop = el.scrollHeight;
    }
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      const before = el.scrollHeight;
      requestAnimationFrame(() => {
        if (scrollRef.current && scrollRef.current.scrollHeight > before) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
          });
        }
      });
    });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const fromBottom = scrollHeight - scrollTop - clientHeight;

    if (atBottomRef.current) {
      if (fromBottom > CHAT_SCROLL_UNPIN_BEYOND_PX) {
        atBottomRef.current = false;
        setAtBottom(false);
      }
    } else if (fromBottom < CHAT_SCROLL_REPIN_WITHIN_PX) {
      atBottomRef.current = true;
      setAtBottom(true);
    }

    if (scrollTop < 100 && !atBottomRef.current && hasMore && !loadingMore) {
      void loadMoreMessages();
    }
  }, [hasMore, loadingMore, loadMoreMessages]);

  useLayoutEffect(() => {
    if (!hasToken) return;
    if (showSessionLoading) {
      prevLoadingRef.current = true;
      return;
    }
    if (prevLoadingRef.current !== true) return;
    prevLoadingRef.current = false;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    requestAnimationFrame(() => {
      scrollToBottom(false, true);
      requestAnimationFrame(() => scrollToBottom(false, true));
    });
  }, [showSessionLoading, hasToken, scrollToBottom]);

  useLayoutEffect(() => {
    if (!hasToken) return;
    if (showSessionLoading) return;
    listScrollMetricsRef.current = { first: undefined, len: 0, scrollHeight: 0 };
    atBottomRef.current = true;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    requestAnimationFrame(() => {
      scrollToBottom(false, true);
      requestAnimationFrame(() => scrollToBottom(false, true));
    });
  }, [sessionKey, hasToken, showSessionLoading, scrollToBottom]);

  useEffect(() => {
    if (!sending) return;
    if (showSessionLoading) return;
    setAtBottom(true);
    scrollToBottom(true, true);
  }, [sending, showSessionLoading, scrollToBottom]);

  /** Wheel / touch intent to view older messages: unpin before React commits so list auto-scroll cannot fight the gesture. */
  useLayoutEffect(() => {
    if (!hasToken || showSessionLoading) return;
    const root = scrollRef.current;
    if (!root) return;

    const unpinFromUserIntent = () => {
      if (!atBottomRef.current) return;
      atBottomRef.current = false;
      flushSync(() => setAtBottom(false));
    };

    const onWheel = (e: WheelEvent) => {
      if (!atBottomRef.current) return;
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (Math.abs(e.deltaY) < 0.25) return;

      const beforeTop = root.scrollTop;
      const beforeFromBottom = chatScrollDistanceFromBottom(root);

      const applyPostWheel = () => {
        const el = scrollRef.current;
        if (!el || !atBottomRef.current) return;

        const afterTop = el.scrollTop;
        const afterFromBottom = chatScrollDistanceFromBottom(el);

        const scrolledTowardHistory =
          afterTop < beforeTop - WHEEL_SCROLL_TOP_EPS ||
          afterFromBottom > beforeFromBottom + WHEEL_FROM_BOTTOM_EPS;

        if (scrolledTowardHistory) {
          unpinFromUserIntent();
          return;
        }

        const noScrollApplied =
          Math.abs(afterTop - beforeTop) < WHEEL_SCROLL_TOP_EPS &&
          Math.abs(afterFromBottom - beforeFromBottom) < WHEEL_FROM_BOTTOM_EPS;

        if (
          noScrollApplied &&
          beforeFromBottom <= 4 &&
          Math.abs(e.deltaY) >= 0.5 &&
          wheelDeltaImpliesTowardOlderMessages(e)
        ) {
          unpinFromUserIntent();
        }
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(applyPostWheel);
      });
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
      if (dy > 2) unpinFromUserIntent();
    };

    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
    };
  }, [hasToken, showSessionLoading]);

  /**
   * Transcript grew while pinned: `scrollHeight` jumps before `scrollTop` is corrected, so
   * `chatScrollDistanceFromBottom` is temporarily large — `scrollToBottom(false)` would mis-treat
   * that as “user left the bottom” and clear `atBottom`. Force keeps follow-the-tail behavior
   * (same idea as Cursor / VS Code chat stick-to-bottom).
   *
   * `useLayoutEffect` + coalesced rAF: align with virtual row layout before paint; batch rapid
   * stream chunks into one scroll pass per frame where possible.
   */
  useLayoutEffect(() => {
    if (showSessionLoading) return;
    if (!atBottom) return;

    if (followTailRafRef.current != null) {
      cancelAnimationFrame(followTailRafRef.current);
    }
    followTailRafRef.current = requestAnimationFrame(() => {
      followTailRafRef.current = null;
      scrollToBottom(false, true);
    });
    return () => {
      if (followTailRafRef.current != null) {
        cancelAnimationFrame(followTailRafRef.current);
        followTailRafRef.current = null;
      }
    };
  }, [chatMessages, atBottom, scrollToBottom, showSessionLoading]);

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

  return { scrollRef, atBottom, scrollToBottom, onScroll };
}
