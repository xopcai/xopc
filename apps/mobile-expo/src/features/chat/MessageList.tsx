/**
 * High-performance message list using @shopify/flash-list.
 * Supports inverted layout (newest at bottom), streaming append,
 * and stick-to-bottom scroll follow (only auto-scroll when pinned near bottom).
 *
 * On session switch the entire FlashList is re-mounted (via React key)
 * so the scroll position resets cleanly — no visible "scroll down" flash.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Icon, IconButton, Text } from 'react-native-paper';

import { useKeyboardListPadding } from '../../hooks/use-keyboard-list-padding';
import { typography, useTheme } from '../../theme';
import { GatewayUnreachableTip } from '../gateway/GatewayUnreachableTip';
import { ChatRenderErrorBoundary } from './ChatRenderErrorBoundary';
import { MessageBubble } from './MessageBubble';
import { isLastAssistantMessage } from './composer-send-helpers';
import type { Message, ProgressState } from './messages.types';
import { useChatListScrollFollow } from './use-chat-list-scroll-follow';

const LIST_BASE_PADDING_BOTTOM = 8;

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
  loadingOlder,
  hasOlder,
  onLoadOlder,
  onAtBottomChange,
  sessionKey,
  welcomeTitle,
  welcomeSubtitle,
  suggestions,
  onSuggestionSend,
  onUserMessageCopy,
  onUserMessageEdit,
  onAssistantCopy,
  onAssistantRegenerate,
  networkUnreachableTip,
}: {
  messages: Message[];
  streaming: boolean;
  progress: ProgressState | null;
  loading: boolean;
  loadingOlder?: boolean;
  hasOlder?: boolean;
  onLoadOlder?: () => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  /** Pass the current session key so we can reset scroll state on session switch. */
  sessionKey?: string;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  suggestions?: string[];
  onSuggestionSend?: (text: string) => void;
  onUserMessageCopy?: (text: string) => void;
  onUserMessageEdit?: (text: string) => void;
  onAssistantCopy?: (text: string) => void;
  onAssistantRegenerate?: (messageIndex: number) => void;
  networkUnreachableTip?: { message: string; onPress: () => void } | null;
}) {
  const { colors } = useTheme();
  const keyboardPadding = useKeyboardListPadding();
  const listRef = useRef<FlashListRef<Message>>(null);

  const {
    listKey,
    showScrollToBottom,
    scrollToBottom,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollEnd,
  } = useChatListScrollFollow({
    listRef,
    messages,
    streaming,
    loadingOlder,
    keyboardPadding,
    sessionKey,
    onAtBottomChange,
    getMessageKey: messageKey,
  });

  const listHeader = useMemo(() => {
    if (!networkUnreachableTip && !loadingOlder) return null;
    return (
      <View>
        {networkUnreachableTip ? (
          <GatewayUnreachableTip
            message={networkUnreachableTip.message}
            onPress={networkUnreachableTip.onPress}
          />
        ) : null}
        {loadingOlder ? (
          <View style={styles.loadingOlderRow}>
            <ActivityIndicator size="small" />
          </View>
        ) : null}
      </View>
    );
  }, [networkUnreachableTip, loadingOlder]);

  const listContentStyle = useMemo(
    () => ({
      paddingTop: 12,
      paddingBottom: LIST_BASE_PADDING_BOTTOM + keyboardPadding,
    }),
    [keyboardPadding],
  );

  const emptyContentStyle = useMemo(
    () => [
      styles.emptyContent,
      { paddingBottom: 32 + keyboardPadding },
    ],
    [keyboardPadding],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const isLast = index === messages.length - 1;
      const isStreamRow = streaming && isLast && item.role === 'assistant';
      return (
        <ChatRenderErrorBoundary
          fallback={
            <View style={styles.bubbleError}>
              <Text variant="bodySmall" style={styles.bubbleErrorText}>
                Unable to display this message.
              </Text>
            </View>
          }
        >
          <MessageBubble
            message={item}
            isStreaming={isStreamRow}
            progress={isStreamRow ? progress : null}
            sessionKey={sessionKey}
            onUserMessageCopy={onUserMessageCopy}
            onUserMessageEdit={onUserMessageEdit}
            onAssistantCopy={onAssistantCopy}
            onAssistantRegenerate={
              onAssistantRegenerate && isLastAssistantMessage(messages, index)
                ? () => onAssistantRegenerate(index)
                : undefined
            }
          />
        </ChatRenderErrorBoundary>
      );
    },
    [messages, onUserMessageCopy, onUserMessageEdit, onAssistantCopy, onAssistantRegenerate, streaming, progress, sessionKey],
  );

  const keyExtractor = useCallback(
    (item: Message, index: number) => messageKey(item, index),
    [],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        {listHeader}
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (messages.length === 0 && !streaming) {
    const chips = suggestions?.filter(Boolean) ?? [];
    return (
      <ScrollView
        style={styles.listFlex}
        contentContainerStyle={emptyContentStyle}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {listHeader}
        <View style={[styles.emptyMark, { backgroundColor: colors.accent.selectionBg }]}>
          <Icon source="creation-outline" size={26} color={colors.accent.primary} />
        </View>
        <Text variant="titleMedium" style={[styles.emptyTitle, { color: colors.text.primary }]}>
          {welcomeTitle ?? 'Start a conversation'}
        </Text>
        <Text variant="bodySmall" style={[styles.emptySubtitle, { color: colors.text.secondary }]}>
          {welcomeSubtitle ?? 'Type a message below to begin chatting with your AI assistant.'}
        </Text>
        {chips.length > 0 ? (
          <View style={styles.chipColumn}>
            {chips.map((label) => (
              <Pressable
                key={label}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: colors.border.default,
                    backgroundColor: colors.surface.panel,
                  },
                  pressed && { backgroundColor: colors.surface.hover },
                ]}
                onPress={() => onSuggestionSend?.(label)}
              >
                <Text variant="bodySmall" style={[styles.chipText, { color: colors.text.primary }]} numberOfLines={2}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={styles.listFlex}>
      <FlashList
        key={listKey}
        ref={listRef}
        style={styles.listFlex}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={listContentStyle}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onStartReached={() => {
          if (!hasOlder || loadingOlder) return;
          onLoadOlder?.();
        }}
        onStartReachedThreshold={0.2}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={listHeader}
      />
      {showScrollToBottom ? (
        <IconButton
          icon="arrow-down"
          mode="contained"
          size={20}
          style={styles.scrollToBottomButton}
          onPress={scrollToBottom}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  listFlex: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 28,
    gap: 10,
  },
  loadingOlderRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  emptyMark: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    ...typography.heading,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...typography.label,
    textAlign: 'center',
    opacity: 0.58,
    maxWidth: 280,
  },
  chipColumn: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 14,
    maxWidth: 340,
    width: '100%',
  },
  chip: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  chipText: {
    ...typography.ui,
    textAlign: 'left',
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  bubbleError: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleErrorText: {
    ...typography.label,
    fontStyle: 'italic',
    opacity: 0.6,
  },
});
