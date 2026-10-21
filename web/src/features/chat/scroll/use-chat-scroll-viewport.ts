import { chatVirtualScroll } from './chat-virtual-scroll';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import {
  chatScrollBehavior,
  isNearChatBottom,
  scrollChatToEnd,
} from '@/features/chat/scroll/chat-scroll-geometry';
import type { Message } from '@/features/chat/messages/messages.types';
import { readChatScrollAnchor, restoreChatScrollAnchor, type ChatScrollAnchor } from './chat-scroll-anchor';

/** WebKit/Chromium: wheel deltas flipped relative to device default (e.g. some mice on macOS). */
function wheelDeltaImpliesTowardOlderMessages(e: WheelEvent): boolean {
  const wk = e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean };
  if (wk.webkitDirectionInvertedFromDevice === true) {
    return e.deltaY > 0;
  }
  return e.deltaY < 0;
}

function sameMessageRow(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b || a.role !== b.role) return false;
  if (a === b) return true;
  if (a.renderKey && b.renderKey) return a.renderKey === b.renderKey;
  if (a.clientSubmissionId && b.clientSubmissionId) return a.clientSubmissionId === b.clientSubmissionId;
  return a.timestamp != null && a.timestamp === b.timestamp && a.turnId === b.turnId;
}

export interface UseChatScrollViewportArgs {
  hasToken: boolean;
  showSessionLoading: boolean;
  conversationId: string | null;
  chatMessages: Message[];
  streaming: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreMessages: () => void | Promise<void>;
}

export interface UseChatScrollViewportResult {
  scrollRef: RefObject<HTMLDivElement | null>;
  composerDockRef: RefObject<HTMLDivElement | null>;
  /** True when the viewport is within the near-bottom threshold, including non-overflowing content. */
  atBottom: boolean;
  registerListContentRef: (el: HTMLDivElement | null) => void;
  scrollToBottom: (smooth?: boolean) => void;
  onScroll: () => void;
  replySpaceRef: RefObject<HTMLDivElement | null>;
  reserveReplySpace: (messageRenderKey: string) => void;
}

/**
 * Cursor-style chat scroll: one container, one “following tail” flag, one scrollToEnd path.
 *
 * - **Following**: content growth (streaming, new rows) keeps the tail in view.
 * - **Not following**: user scrolled up — never programmatic scroll until they return.
 * - **Force to end**: session open/switch, scroll-to-bottom button.
 *
 * The virtual history adapter shares this controller and owns prepend measurements.
 */
export function useChatScrollViewport({
  hasToken,
  showSessionLoading,
  conversationId,
  chatMessages,
  streaming,
  hasMore,
  loadingMore,
  loadMoreMessages,
}: UseChatScrollViewportArgs): UseChatScrollViewportResult {
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const replySpaceRef = useRef<HTMLDivElement>(null);
  const replyAnchorRef = useRef<string | null>(null);
  const replyAnchorElementRef = useRef<HTMLElement | null>(null);
  const pendingReplyAnchorRef = useRef<string | null>(null);
  const replyBudgetRef = useRef(0);
  const replyExtentRef = useRef(0);
  const virtualMeasurementObserverRef = useRef<MutationObserver | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const readingAnchorRef = useRef<ChatScrollAnchor | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const measuredScrollHeightRef = useRef(0);
  const measuredClientHeightRef = useRef(0);

  const [atBottom, setAtBottom] = useState(true);

  const prevLoadingRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const wasStreamingRef = useRef(streaming);

  const listScrollMetricsRef = useRef<{
    first: Message | undefined;
    len: number;
    scrollHeight: number;
  }>({ first: undefined, len: 0, scrollHeight: 0 });

  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
    if (next) readingAnchorRef.current = null;
  }, []);

  const reserveReplySpace = useCallback((messageRenderKey: string) => {
    if (!followingRef.current) return;
    pendingReplyAnchorRef.current = messageRenderKey;
  }, []);

  const updateReplySpace = useCallback(() => {
    const el = scrollRef.current;
    const spacer = replySpaceRef.current;
    if (!el || !spacer || !followingRef.current) return false;
    if (!pendingReplyAnchorRef.current && !replyAnchorRef.current) return false;
    const key = pendingReplyAnchorRef.current ?? replyAnchorRef.current;
    if (!key) return false;
    const row = !pendingReplyAnchorRef.current && replyAnchorElementRef.current?.isConnected
      ? replyAnchorElementRef.current
      : Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row]'))
        .find((element) => element.dataset.messageRenderKey === key || element.dataset.clientSubmissionId === key);
    if (!row) return false;
    if (pendingReplyAnchorRef.current) {
      replyAnchorRef.current = key;
      replyAnchorElementRef.current = row;
      pendingReplyAnchorRef.current = null;
      replyBudgetRef.current = Math.min(64, Math.max(0, el.clientHeight) * 0.1);
      replyExtentRef.current = replyBudgetRef.current;
    }
    // Virtual row offsets can settle after the footer mounts; its fixed gap is already occupied.
    const footerGap = parseFloat(getComputedStyle(spacer.parentElement!).paddingTop) || 0;
    const replyHeight = Math.max(footerGap, spacer.getBoundingClientRect().top - row.getBoundingClientRect().bottom);
    // Absorb small contractions, including transient status UI, within the original budget.
    const extent = Math.max(replyExtentRef.current, replyHeight);
    const budget = Math.min(replyBudgetRef.current, Math.min(64, Math.max(0, el.clientHeight) * 0.1));
    const remaining = Math.max(0, Math.min(budget, extent - replyHeight));
    replyExtentRef.current = replyHeight + remaining;
    if (spacer.style.height === `${remaining}px`) return false;
    spacer.style.height = `${remaining}px`;
    return true;
  }, []);

  const scrollToEnd = useCallback(
    (opts?: { force?: boolean; smooth?: boolean }) => {
      const el = scrollRef.current;
      if (!el) return;
      if (!opts?.force && !followingRef.current) return;

      if (opts?.force) {
        setFollowing(true);
      }

      const virtual = chatVirtualScroll(el);
      if (virtual) {
        virtual.end(Boolean(opts?.smooth));
        measuredScrollHeightRef.current = el.scrollHeight;
        measuredClientHeightRef.current = el.clientHeight;
        return;
      }
      if (opts?.smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: chatScrollBehavior() });
        return;
      }

      scrollChatToEnd(el);
      measuredScrollHeightRef.current = el.scrollHeight;
      measuredClientHeightRef.current = el.clientHeight;
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
    const el = scrollRef.current;
    if (!el) return;
    if (!followingRef.current && !chatVirtualScroll(el)) restoreChatScrollAnchor(el, readingAnchorRef.current);
    const replySpaceChanged = updateReplySpace();
    const grew = el.scrollHeight > measuredScrollHeightRef.current;
    const viewportShrank = el.clientHeight < measuredClientHeightRef.current;
    measuredScrollHeightRef.current = el.scrollHeight;
    measuredClientHeightRef.current = el.clientHeight;
    // An unbuffered shrink is already clamped by the browser; only reassert the
    // tail when growth, viewport shrink, or adjusted reply space needs it.
    if (grew || viewportShrank || replySpaceChanged) scrollToEnd();
    // Resizing the composer or keyboard must not re-enable following for history readers.
    setAtBottom(isNearChatBottom(el));
  }, [scrollToEnd, updateReplySpace]);

  const scheduleResize = useCallback(() => {
    const el = scrollRef.current;
    if (el && followingRef.current) {
      if (chatVirtualScroll(el)) {
        scrollChatToEnd(el);
      } else if (el.scrollHeight > measuredScrollHeightRef.current) scrollToEnd();
    }
    if (resizeFrameRef.current !== null) return;
    // Updating an observed column's spacer inside ResizeObserver causes a feedback warning.
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      onResize();
    });
  }, [onResize, scrollToEnd]);

  const registerListContentRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (listContentRef.current === el) return;

      resizeObserverRef.current?.disconnect();
      virtualMeasurementObserverRef.current?.disconnect();
      virtualMeasurementObserverRef.current = null;
      resizeObserverRef.current = null;
      listContentRef.current = el;

      if (!el) return;

      // Correct the tail before paint and remeasure after rows grow or collapse.
      const ro = new ResizeObserver(scheduleResize);
      ro.observe(el);
      resizeObserverRef.current = ro;
      // Consume reply space on text commits before Virtuoso measures the combined extent.
      // Follow its resulting height commit before paint without starting another index seek.
      const measurements = new MutationObserver(records => {
        const viewport = scrollRef.current;
        if (!viewport || !followingRef.current || !chatVirtualScroll(viewport)) return;
        const replySpaceChanged = updateReplySpace();
        if (replySpaceChanged || records.some(record => record.target instanceof HTMLElement
          && record.target.hasAttribute('data-virtuoso-scroller'))) {
          scrollChatToEnd(viewport);
        }
      });
      measurements.observe(el, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['style'] });
      virtualMeasurementObserverRef.current = measurements;
    },
    [scheduleResize, updateReplySpace],
  );

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      virtualMeasurementObserverRef.current?.disconnect();
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const near = isNearChatBottom(el);
    const layoutChanged = measuredClientHeightRef.current > 0
      && (el.scrollHeight !== measuredScrollHeightRef.current
        || el.clientHeight !== measuredClientHeightRef.current);
    // A queued layout scroll can arrive before ResizeObserver's frame. It must
    // not revoke following while newly rendered content is still being measured.
    if (!near && followingRef.current && layoutChanged) {
      setAtBottom(false);
      scheduleResize();
      return;
    }
    setFollowing(near);
    if (!near) readingAnchorRef.current = readChatScrollAnchor(el);
    setAtBottom(near);
    if (near) updateReplySpace();

    if (el.scrollTop < 100 && !near && hasMore && !loadingMore) {
      void loadMoreMessages();
    }
  }, [setFollowing, hasMore, loadingMore, loadMoreMessages, updateReplySpace, scheduleResize]);

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
    measuredScrollHeightRef.current = 0;
    measuredClientHeightRef.current = 0;
    replyAnchorRef.current = null;
    replyAnchorElementRef.current = null;
    replyExtentRef.current = 0;
    if (!Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-chat-message-row]') ?? [])
      .some((element) => element.dataset.messageRenderKey === pendingReplyAnchorRef.current
        || element.dataset.clientSubmissionId === pendingReplyAnchorRef.current)) {
      pendingReplyAnchorRef.current = null;
    }
    if (replySpaceRef.current) replySpaceRef.current.style.height = '0px';
    setFollowing(true);
    scrollToEnd({ force: true });
  }, [conversationId, hasToken, showSessionLoading, setFollowing, scrollToEnd]);

  useLayoutEffect(() => {
    if (showSessionLoading) return;

    // Text part subscriptions can keep the message shell array stable at completion.
    const streamCompleted = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;
    const replySpaceChanged = updateReplySpace();

    const count = chatMessages.length;
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = count;

    const contentGrew = (scrollRef.current?.scrollHeight ?? 0) > measuredScrollHeightRef.current;
    if (followingRef.current && (count > prevCount || contentGrew || replySpaceChanged || streamCompleted)) {
      scrollToEnd();
    }
  }, [chatMessages, streaming, showSessionLoading, scrollToEnd, updateReplySpace]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || showSessionLoading) return;

    const prev = listScrollMetricsRef.current;
    const first = chatMessages[0];
    const len = chatMessages.length;
    const newHeight = el.scrollHeight;
    const added = len - prev.len;
    const prepended = added > 0 && prev.len > 0
      && !sameMessageRow(first, prev.first)
      && sameMessageRow(chatMessages[added], prev.first);

    if (prepended && !chatVirtualScroll(el) && prev.scrollHeight > 0 && !restoreChatScrollAnchor(el, readingAnchorRef.current)) {
      el.scrollTop += newHeight - prev.scrollHeight;
    }

    listScrollMetricsRef.current = { first, len, scrollHeight: newHeight };
  }, [chatMessages, showSessionLoading]);

  useLayoutEffect(() => {
    if (!hasToken || showSessionLoading) return;
    const root = scrollRef.current;
    if (!root) return;

    const viewportObserver = new ResizeObserver(scheduleResize);
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

    const pauseForSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode)) return;
      stopFollowing();
      readingAnchorRef.current = readChatScrollAnchor(root);
    };
    const pauseForDisclosure = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest('button[aria-expanded="false"]:not([aria-haspopup]), summary')) return;
      stopFollowing();
      readingAnchorRef.current = readChatScrollAnchor(root);
    };

    root.addEventListener('chat-scroll-reading', stopFollowing);
    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    root.addEventListener('click', pauseForDisclosure, true);
    document.addEventListener('selectionchange', pauseForSelection);
    return () => {
      viewportObserver.disconnect();
      root.removeEventListener('chat-scroll-reading', stopFollowing);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('click', pauseForDisclosure, true);
      document.removeEventListener('selectionchange', pauseForSelection);
    };
  }, [hasToken, showSessionLoading, stopFollowing, scheduleResize]);

  useLayoutEffect(() => {
    if (!hasToken) return;
    const viewport = scrollRef.current;
    const dock = composerDockRef.current;
    if (!viewport || !dock) return;

    // Reserve the full dock height, including attachments, plans and safe-area spacing.
    const measure = () => {
      const inset = `${dock.getBoundingClientRect().height + 16}px`;
      viewport.style.paddingBottom = inset;
      viewport.style.scrollPaddingBottom = inset;
      scheduleResize();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      viewport.style.removeProperty('padding-bottom');
      viewport.style.removeProperty('scroll-padding-bottom');
    };
  }, [hasToken, showSessionLoading, scheduleResize]);

  return {
    scrollRef,
    composerDockRef,
    atBottom,
    registerListContentRef,
    scrollToBottom,
    onScroll,
    replySpaceRef,
    reserveReplySpace,
  };
}
