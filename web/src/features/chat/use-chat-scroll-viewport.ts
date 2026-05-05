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

export interface UseChatScrollViewportArgs {
  hasToken: boolean;
  showSessionLoading: boolean;
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
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (e.deltaY >= -0.001) return;
      unpinFromUserIntent();
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

  useEffect(() => {
    if (showSessionLoading) return;
    if (!atBottom) return;
    scrollToBottom(false);
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
