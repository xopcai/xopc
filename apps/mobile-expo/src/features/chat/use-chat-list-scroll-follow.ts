/**
 * Stick-to-bottom scroll follow for chat FlashList.
 * Mirrors web use-chat-scroll-viewport: pin/unpin, drag guard, coalesced rAF follow.
 */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import {
  applyPinHysteresis,
  chatListDistanceFromBottom,
  CHAT_LIST_UNPIN_BEYOND_PX,
  isUserScrollTowardHistory,
} from './chat-scroll-geometry';
import type { Message } from './messages.types';

type ScrollMetrics = {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
};

function readScrollMetrics(event: NativeSyntheticEvent<NativeScrollEvent>): ScrollMetrics {
  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
  return {
    offsetY: contentOffset.y,
    contentHeight: contentSize.height,
    viewportHeight: layoutMeasurement.height,
  };
}

export function useChatListScrollFollow({
  listRef,
  messages,
  streaming,
  loadingOlder,
  keyboardPadding,
  sessionKey,
  onAtBottomChange,
  getMessageKey,
}: {
  listRef: RefObject<FlashListRef<Message> | null>;
  messages: Message[];
  streaming: boolean;
  loadingOlder?: boolean;
  keyboardPadding: number;
  sessionKey?: string;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  getMessageKey: (msg: Message, index: number) => string;
}) {
  const pinnedToBottomRef = useRef(true);
  const isDraggingRef = useRef(false);
  const dragStartOffsetYRef = useRef(0);
  const followTailRafRef = useRef<number | null>(null);

  const lastScrollMetricsRef = useRef<ScrollMetrics>({
    offsetY: 0,
    contentHeight: 0,
    viewportHeight: 0,
  });
  const lastFollowLayoutScrollTopRef = useRef(0);
  const lastFollowLayoutScrollHeightRef = useRef(0);

  const prevLengthRef = useRef(messages.length);
  const prevFirstKeyRef = useRef(messages[0] ? getMessageKey(messages[0], 0) : '');
  const prevLastKeyRef = useRef(
    messages.length > 0 ? getMessageKey(messages[messages.length - 1], messages.length - 1) : '',
  );

  const prevSessionKeyRef = useRef(sessionKey);
  const [listKey, setListKey] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const syncPinState = useCallback(
    (nextPinned: boolean) => {
      if (pinnedToBottomRef.current === nextPinned) return;
      pinnedToBottomRef.current = nextPinned;
      onAtBottomChange?.(nextPinned);
      setShowScrollToBottom(!nextPinned && messages.length > 0);
    },
    [messages.length, onAtBottomChange],
  );

  const unpin = useCallback(() => {
    syncPinState(false);
  }, [syncPinState]);

  const pin = useCallback(() => {
    syncPinState(true);
  }, [syncPinState]);

  const scrollToEnd = useCallback(
    (animated: boolean) => {
      listRef.current?.scrollToEnd({ animated });
    },
    [listRef],
  );

  const forceScrollToBottom = useCallback(
    (animated = true) => {
      pin();
      scrollToEnd(animated);
      setShowScrollToBottom(false);
    },
    [pin, scrollToEnd],
  );

  const applyScrollMetrics = useCallback(
    (metrics: ScrollMetrics, { duringDrag }: { duringDrag?: boolean } = {}) => {
      const { offsetY, contentHeight, viewportHeight } = metrics;
      lastScrollMetricsRef.current = metrics;

      const distanceFromBottom = chatListDistanceFromBottom(offsetY, contentHeight, viewportHeight);
      const nextPinned = applyPinHysteresis(pinnedToBottomRef.current, distanceFromBottom);
      syncPinState(nextPinned);

      if (duringDrag && isDraggingRef.current) {
        if (offsetY < dragStartOffsetYRef.current - 2) {
          unpin();
        }
      }
    },
    [syncPinState, unpin],
  );

  useEffect(() => {
    if (sessionKey !== prevSessionKeyRef.current) {
      prevSessionKeyRef.current = sessionKey;
      prevLengthRef.current = 0;
      prevFirstKeyRef.current = '';
      prevLastKeyRef.current = '';
      pinnedToBottomRef.current = true;
      onAtBottomChange?.(true);
      setShowScrollToBottom(false);
      setListKey((k) => k + 1);
    }
  }, [sessionKey, onAtBottomChange]);

  useLayoutEffect(() => {
    if (messages.length === 0) return;

    const firstKey = getMessageKey(messages[0], 0);
    const lastIndex = messages.length - 1;
    const lastKey = getMessageKey(messages[lastIndex], lastIndex);
    const initialLoad = prevLengthRef.current === 0;
    const appendedToTail = prevFirstKeyRef.current === firstKey && prevLastKeyRef.current !== lastKey;

    prevLengthRef.current = messages.length;
    prevFirstKeyRef.current = firstKey;
    prevLastKeyRef.current = lastKey;

    if (loadingOlder && !appendedToTail && !initialLoad && !streaming) {
      return;
    }

    if (appendedToTail && !loadingOlder) {
      pin();
    }

    if (initialLoad) {
      pin();
      if (followTailRafRef.current != null) {
        cancelAnimationFrame(followTailRafRef.current);
      }
      followTailRafRef.current = requestAnimationFrame(() => {
        followTailRafRef.current = null;
        scrollToEnd(false);
      });
      return;
    }

    if (!pinnedToBottomRef.current || isDraggingRef.current) {
      const m = lastScrollMetricsRef.current;
      lastFollowLayoutScrollTopRef.current = m.offsetY;
      lastFollowLayoutScrollHeightRef.current = m.contentHeight;
      return;
    }

    const st = lastScrollMetricsRef.current.offsetY;
    const sh = lastScrollMetricsRef.current.contentHeight;
    const prevSt = lastFollowLayoutScrollTopRef.current;
    const prevSh = lastFollowLayoutScrollHeightRef.current;

    if (isUserScrollTowardHistory(st, prevSt, sh, prevSh)) {
      unpin();
      lastFollowLayoutScrollTopRef.current = st;
      lastFollowLayoutScrollHeightRef.current = sh;
      return;
    }

    if (followTailRafRef.current != null) {
      cancelAnimationFrame(followTailRafRef.current);
    }
    followTailRafRef.current = requestAnimationFrame(() => {
      followTailRafRef.current = null;
      if (!pinnedToBottomRef.current || isDraggingRef.current) return;
      scrollToEnd(false);
      lastFollowLayoutScrollTopRef.current = lastScrollMetricsRef.current.offsetY;
      lastFollowLayoutScrollHeightRef.current = lastScrollMetricsRef.current.contentHeight;
    });

    return () => {
      if (followTailRafRef.current != null) {
        cancelAnimationFrame(followTailRafRef.current);
        followTailRafRef.current = null;
      }
    };
  }, [messages, streaming, loadingOlder, getMessageKey, pin, unpin, scrollToEnd]);

  useEffect(() => {
    if (keyboardPadding <= 0 || messages.length === 0 || !pinnedToBottomRef.current) return;
    if (followTailRafRef.current != null) {
      cancelAnimationFrame(followTailRafRef.current);
    }
    followTailRafRef.current = requestAnimationFrame(() => {
      followTailRafRef.current = null;
      if (!pinnedToBottomRef.current) return;
      scrollToEnd(true);
    });
  }, [keyboardPadding, messages.length, scrollToEnd]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      applyScrollMetrics(readScrollMetrics(event), { duringDrag: isDraggingRef.current });
    },
    [applyScrollMetrics],
  );

  const onScrollBeginDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      isDraggingRef.current = true;
      const metrics = readScrollMetrics(event);
      dragStartOffsetYRef.current = metrics.offsetY;
      applyScrollMetrics(metrics, { duringDrag: true });

      const distanceFromBottom = chatListDistanceFromBottom(
        metrics.offsetY,
        metrics.contentHeight,
        metrics.viewportHeight,
      );
      if (distanceFromBottom > CHAT_LIST_UNPIN_BEYOND_PX) {
        unpin();
      }
    },
    [applyScrollMetrics, unpin],
  );

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      isDraggingRef.current = false;
      applyScrollMetrics(readScrollMetrics(event));
    },
    [applyScrollMetrics],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      isDraggingRef.current = false;
      applyScrollMetrics(readScrollMetrics(event));
    },
    [applyScrollMetrics],
  );

  const scrollToBottom = useCallback(() => {
    forceScrollToBottom(true);
  }, [forceScrollToBottom]);

  return {
    listKey,
    showScrollToBottom,
    scrollToBottom,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollEnd,
  };
}
