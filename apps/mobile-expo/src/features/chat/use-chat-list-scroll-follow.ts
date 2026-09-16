/** Follow measured content growth without mistaking native layout adjustments for user scrolling. */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { applyPinHysteresis, chatListDistanceFromBottom, shouldShowChatScrollToBottom } from './chat-scroll-geometry';
import type { Message } from './messages.types';

export function useChatListScrollFollow({
  listRef,
  messages,
  loadingOlder = false,
  conversationId,
  onAtBottomChange,
  getMessageKey,
}: {
  listRef: RefObject<FlashListRef<Message> | null>;
  messages: Message[];
  loadingOlder?: boolean;
  conversationId?: string;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  getMessageKey: (msg: Message, index: number) => string;
}) {
  const keyboard = useReanimatedKeyboardAnimation();
  const keyboardTransition = useSharedValue(false);
  const pendingContentFollow = useRef(false);
  const pinnedRef = useRef(true);
  const draggingRef = useRef(false);
  const momentumRef = useRef(false);
  const dragStartYRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const previousRef = useRef({ conversationId, lastKey: '', length: 0 });
  const metricsRef = useRef({ offsetY: 0, contentHeight: 0, viewportHeight: 0 });
  const contentLayoutHeightRef = useRef(0);
  const buttonVisibleRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const keyboardInset = useCallback(() => Math.abs(keyboard.height.value), [keyboard.height]);
  const keyboardMoving = useCallback(() => keyboardTransition.value || (keyboard.progress.value > 0 && keyboard.progress.value < 1), [keyboard.progress, keyboardTransition]);
  const scrollToLiveEdge = useCallback(() => {
    const inset = keyboardInset();
    if (inset > 0) {
      const { contentHeight, viewportHeight } = metricsRef.current;
      listRef.current?.scrollToOffset({ offset: Math.max(0, contentHeight + inset - viewportHeight), animated: false });
    } else {
      void listRef.current?.scrollToEnd({ animated: false });
    }
  }, [keyboardInset, listRef]);

  const syncButtonVisibility = useCallback(() => {
    const { offsetY, contentHeight, viewportHeight } = metricsRef.current;
    const visible = !pinnedRef.current && shouldShowChatScrollToBottom(
      offsetY, contentHeight + keyboardInset(), viewportHeight, buttonVisibleRef.current,
    );
    if (buttonVisibleRef.current === visible) return;
    buttonVisibleRef.current = visible;
    setShowScrollToBottom(visible);
  }, [keyboardInset]);

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

  const scheduleFollow = useCallback((deferContent = false) => {
    if (!pinnedRef.current || draggingRef.current || momentumRef.current) return;
    if (deferContent) pendingContentFollow.current = true;
    if (keyboardMoving()) return;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!pinnedRef.current || draggingRef.current || momentumRef.current) return;
      if (keyboardMoving()) {
        if (deferContent) pendingContentFollow.current = true;
        return;
      }
      pendingContentFollow.current = false;
      scrollToLiveEdge();
    });
  }, [keyboardMoving, scrollToLiveEdge]);

  const finishKeyboardTransition = useCallback(() => {
    if (!pendingContentFollow.current) return;
    pendingContentFollow.current = false;
    scheduleFollow(true);
  }, [scheduleFollow]);

  useKeyboardHandler({
    onStart: () => { 'worklet'; keyboardTransition.value = true; },
    onInteractive: () => { 'worklet'; keyboardTransition.value = true; },
    onEnd: () => {
      'worklet';
      keyboardTransition.value = false;
      scheduleOnRN(finishKeyboardTransition);
    },
  }, [finishKeyboardTransition]);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const last = messages[messages.length - 1];
    const lastKey = last ? getMessageKey(last, messages.length - 1) : '';
    if (previous.conversationId !== conversationId) {
      cancelFollow();
      pendingContentFollow.current = false;
      draggingRef.current = false;
      momentumRef.current = false;
      pinnedRef.current = true;
      metricsRef.current = { offsetY: 0, contentHeight: 0, viewportHeight: 0 };
      contentLayoutHeightRef.current = 0;
      buttonVisibleRef.current = false;
      setShowScrollToBottom(false);
      onAtBottomChange?.(true);
    } else if (messages.length > previous.length && lastKey !== previous.lastKey) {
      if (last?.role === 'user' || last?.role === 'user-with-attachments') {
        // A newly sent prompt always returns the conversation to the live edge.
        setPinned(true);
      }
      // Assistant rows follow only while already pinned; history readers stay undisturbed.
      scheduleFollow(true);
    }
    previousRef.current = { conversationId, lastKey, length: messages.length };
  }, [conversationId, messages, getMessageKey, cancelFollow, onAtBottomChange, setPinned, scheduleFollow]);

  useEffect(() => cancelFollow, [cancelFollow]);

  const updateUserPosition = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metricsRef.current = { offsetY: contentOffset.y, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height };
    const distance = chatListDistanceFromBottom(contentOffset.y, contentSize.height + keyboardInset(), layoutMeasurement.height);
    setPinned(contentSize.height + keyboardInset() <= layoutMeasurement.height
      || applyPinHysteresis(pinnedRef.current, distance));
    if (contentSize.height > layoutMeasurement.height
      && draggingRef.current && contentOffset.y < dragStartYRef.current - 2) setPinned(false);
    syncButtonVisibility();
  }, [keyboardInset, setPinned, syncButtonVisibility]);

  const recordMetrics = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metricsRef.current = {
      offsetY: contentOffset.y,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
    };
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    const previousHeight = contentLayoutHeightRef.current;
    contentLayoutHeightRef.current = height;
    metricsRef.current.contentHeight = height;
    syncButtonVisibility();
    // One owner for content follow; FlashList must not scroll again on viewport resize.
    if (!loadingOlder && Math.abs(height - previousHeight) > 1) scheduleFollow(true);
  }, [loadingOlder, scheduleFollow, syncButtonVisibility]);

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
    scrollToLiveEdge();
  }, [scrollToLiveEdge, setPinned]);

  return {
    listKey: conversationId ?? '',
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
