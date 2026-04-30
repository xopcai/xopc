/**
 * High-performance message list using @shopify/flash-list.
 * Supports inverted layout (newest at bottom), streaming append,
 * and scroll-to-bottom behavior.
 *
 * On session switch the entire FlashList is re-mounted (via React key)
 * so the scroll position resets cleanly — no visible "scroll down" flash.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';

import { MessageBubble } from './MessageBubble';
import type { Message, ProgressState } from './messages.types';

/** Generate a stable key for each message row. */
function messageKey(msg: Message, index: number): string {
  if (msg.timestamp) return `${msg.role}-${msg.timestamp}-${index}`;
  return `${msg.role}-${index}`;
}

export const MessageList = memo(function MessageList({
  messages,
  streaming,
  progress,
  loading,
  sessionKey,
}: {
  messages: Message[];
  streaming: boolean;
  progress: ProgressState | null;
  loading: boolean;
  /** Pass the current session key so we can reset scroll state on session switch. */
  sessionKey?: string;
}) {
  const listRef = useRef<FlashListRef<Message>>(null);
  const isAtBottomRef = useRef(true);
  const prevLengthRef = useRef(messages.length);

  /**
   * Monotonically increasing counter bumped on every sessionKey change.
   * Used as the React `key` of FlashList so it fully re-mounts,
   * which avoids the visible "scroll from top to bottom" flash on web.
   */
  const prevSessionKeyRef = useRef(sessionKey);
  const [listKey, setListKey] = useState(0);

  useEffect(() => {
    if (sessionKey !== prevSessionKeyRef.current) {
      prevSessionKeyRef.current = sessionKey;
      prevLengthRef.current = 0;
      isAtBottomRef.current = true;
      // Bump key → FlashList unmounts/remounts with fresh scroll position
      setListKey((k) => k + 1);
    }
  }, [sessionKey]);

  // Auto-scroll when new messages arrive or during streaming
  useEffect(() => {
    if (messages.length === 0) return;
    const lengthChanged = messages.length !== prevLengthRef.current;
    prevLengthRef.current = messages.length;

    if (isAtBottomRef.current || lengthChanged || streaming) {
      // Use double-rAF to ensure FlashList has laid out the new content before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
        });
      });
    }
  }, [messages, streaming]);

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const isLast = index === messages.length - 1;
      const isStreamRow = streaming && isLast && item.role === 'assistant';
      return (
        <MessageBubble
          message={item}
          isStreaming={isStreamRow}
          progress={isStreamRow ? progress : null}
        />
      );
    },
    [messages.length, streaming, progress],
  );

  const keyExtractor = useCallback(
    (item: Message, index: number) => messageKey(item, index),
    [],
  );

  const onScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
      isAtBottomRef.current = distanceFromBottom < 60;
    },
    [],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (messages.length === 0 && !streaming) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🤖</Text>
        <Text variant="titleMedium" style={styles.emptyTitle}>
          Start a conversation
        </Text>
        <Text variant="bodySmall" style={styles.emptySubtitle}>
          Type a message below to begin chatting with your AI assistant.
        </Text>
      </View>
    );
  }

  return (
    <FlashList
      key={listKey}
      ref={listRef}
      data={messages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      onMomentumScrollEnd={onScrollEnd}
      onScrollEndDrag={onScrollEnd}
      showsVerticalScrollIndicator={false}
    />
  );
});

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyTitle: {
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    opacity: 0.6,
    maxWidth: 260,
    lineHeight: 18,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 8,
  },
});
