/** Follow measured content growth without mistaking native layout adjustments for user scrolling. */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { applyPinHysteresis, chatListDistanceFromBottom, shouldShowChatScrollToBottom } from './chat-scroll-geometry';
import type { Message } from './messages.types';

export function useChatListScrollFollow({
  listRef,
  messages,
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
  const pinnedRef = useRef(true);
  const draggingRef = useRef(false);
  const momentumRef = useRef(false);
  const dragStartYRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const previousRef = useRef({ sessionKey, lastKey: '', length: 0 });
  const metricsRef = useRef({ offsetY: 0, contentHeight: 0, viewportHeight: 0 });
  const buttonVisibleRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const syncButtonVisibility = useCallback(() => {
    const { offsetY, contentHeight, viewportHeight } = metricsRef.current;
    const visible = !pinnedRef.current && shouldShowChatScrollToBottom(
      offsetY, contentHeight, viewportHeight, buttonVisibleRef.current,
    );
    if (buttonVisibleRef.current === visible) return;
    buttonVisibleRef.current = visible;
    setShowScrollToBottom(visible);
  }, []);

  const setPinned = useCallback((pinned: boolean) => {
    if (pinnedRef.current === pinned) return;
    pinnedRef.current = pinned;
    syncButtonVisibility();
    onAtBottomChange?.(pinned);
  }, [onAtBottomChange, syncButtonVisibility]);

  const cancelFollow = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const scheduleFollow = useCallback(() => {
    if (!pinnedRef.current || draggingRef.current || momentumRef.current || frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!pinnedRef.current || draggingRef.current || momentumRef.current) return;
      void listRef.current?.scrollToEnd({ animated: false });
    });
  }, [listRef]);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const last = messages[messages.length - 1];
    const lastKey = last ? getMessageKey(last, messages.length - 1) : '';
    if (previous.sessionKey !== sessionKey) {
      cancelFollow();
      draggingRef.current = false;
      momentumRef.current = false;
      pinnedRef.current = true;
      metricsRef.current = { offsetY: 0, contentHeight: 0, viewportHeight: 0 };
      buttonVisibleRef.current = false;
      setShowScrollToBottom(false);
      onAtBottomChange?.(true);
    } else if (
      messages.length > previous.length && lastKey !== previous.lastKey
      && (last?.role === 'user' || last?.role === 'user-with-attachments')
    ) {
      // Sending a new prompt may pin; an incoming answer must not interrupt history reading.
      setPinned(true);
      scheduleFollow();
    }
    previousRef.current = { sessionKey, lastKey, length: messages.length };
  }, [sessionKey, messages, getMessageKey, cancelFollow, onAtBottomChange, setPinned, scheduleFollow]);

  useEffect(() => cancelFollow, [cancelFollow]);
  useEffect(() => { scheduleFollow(); }, [keyboardPadding, scheduleFollow]);

  const updateUserPosition = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metricsRef.current = { offsetY: contentOffset.y, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height };
    const distance = chatListDistanceFromBottom(contentOffset.y, contentSize.height, layoutMeasurement.height);
    setPinned(contentSize.height <= layoutMeasurement.height
      || applyPinHysteresis(pinnedRef.current, distance));
    if (contentSize.height > layoutMeasurement.height
      && draggingRef.current && contentOffset.y < dragStartYRef.current - 2) setPinned(false);
    syncButtonVisibility();
  }, [setPinned, syncButtonVisibility]);

  const recordMetrics = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metricsRef.current = {
      offsetY: contentOffset.y,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
    };
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    metricsRef.current.contentHeight = height;
    syncButtonVisibility();
    scheduleFollow();
  }, [syncButtonVisibility, scheduleFollow]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    metricsRef.current.viewportHeight = event.nativeEvent.layout.height;
    syncButtonVisibility();
    scheduleFollow();
  }, [syncButtonVisibility, scheduleFollow]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    recordMetrics(event);
    // Content growth and FlashList anchoring also emit scroll events. Only gestures change intent.
    if (draggingRef.current || momentumRef.current) updateUserPosition(event);
    syncButtonVisibility();
  }, [recordMetrics, updateUserPosition, syncButtonVisibility]);

  const onScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    cancelFollow();
    draggingRef.current = true;
    momentumRef.current = false;
    dragStartYRef.current = event.nativeEvent.contentOffset.y;
    updateUserPosition(event);
  }, [cancelFollow, updateUserPosition]);

  const onScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    updateUserPosition(event);
    draggingRef.current = false;
    scheduleFollow();
  }, [updateUserPosition, scheduleFollow]);

  const onMomentumScrollBegin = useCallback(() => {
    momentumRef.current = true;
    cancelFollow();
  }, [cancelFollow]);

  const onMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    momentumRef.current = false;
    updateUserPosition(event);
    scheduleFollow();
  }, [updateUserPosition, scheduleFollow]);

  const scrollToBottom = useCallback(() => {
    setPinned(true);
    void listRef.current?.scrollToEnd({ animated: true });
  }, [listRef, setPinned]);

  return {
    listKey: sessionKey ?? '',
    showScrollToBottom,
    scrollToBottom,
    onContentSizeChange,
    onLayout,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  };
}
