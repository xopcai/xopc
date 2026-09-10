/**
 * High-performance message list using @shopify/flash-list.
 * Supports inverted layout (newest at bottom), streaming append,
 * and stick-to-bottom scroll follow (only auto-scroll when pinned near bottom).
 *
 * On session switch the entire FlashList is re-mounted (via React key)
 * so the scroll position resets cleanly — no visible "scroll down" flash.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Button, Icon, IconButton, Text } from 'react-native-paper';

import { useKeyboardListPadding } from '../../hooks/use-keyboard-list-padding';
import { useMessages } from '../../i18n/messages';
import { typography, useTheme } from '../../theme';
import { GatewayUnreachableTip } from '../gateway/GatewayUnreachableTip';
import { ChatRenderErrorBoundary } from './ChatRenderErrorBoundary';
import { MessageBubble } from './MessageBubble';
import { messageKey } from './message-key';
import type { Message, ProgressState, ReasoningLevel } from './messages.types';
import type { MobileWelcomeStarter } from './mobile-welcome-starters';
import { useChatListScrollFollow } from './use-chat-list-scroll-follow';

const LIST_BASE_PADDING_BOTTOM = 8;
const LOADING_INDICATOR_DELAY_MS = 160;
const CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: 0.08,
  animateAutoScrollToBottom: false,
} as const;

function useDelayedLoadingIndicator(loading: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return undefined;
    }
    const timer = setTimeout(() => setVisible(true), LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  return visible;
}

function starterIconSource(icon: string): string {
  switch (icon) {
    case 'code':
      return 'code-tags';
    case 'review':
      return 'clipboard-check-outline';
    case 'note':
      return 'notebook-outline';
    case 'task':
      return 'format-list-checks';
    case 'target':
      return 'target';
    case 'search':
      return 'magnify';
    case 'folder':
      return 'folder-outline';
    case 'content':
      return 'text-box-edit-outline';
    case 'documents':
      return 'file-document-outline';
    case 'globe':
      return 'web';
    default:
      return 'creation-outline';
  }
}

export const MessageList = memo(function MessageList({
  messages,
  reasoningLevel,
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
  welcomeStarters,
  suggestions,
  onSuggestionSend,
  onUserMessageCopy,
  onUserMessageEdit,
  onUserMessageRetry,
  onAssistantCopy,
  onAssistantSaveToNote,
  onAssistantRegenerate,
  loadError,
  networkUnreachableTip,
}: {
  messages: Message[];
  reasoningLevel: ReasoningLevel;
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
  welcomeStarters?: MobileWelcomeStarter[];
  suggestions?: string[];
  onSuggestionSend?: (text: string) => void;
  onUserMessageCopy?: (text: string) => void;
  onUserMessageEdit?: (text: string) => void;
  onUserMessageRetry?: (message: Message) => void;
  onAssistantCopy?: (text: string) => void;
  onAssistantSaveToNote?: (text: string) => void;
  onAssistantRegenerate?: (messageIndex: number) => void;
  loadError?: { message: string; retryLabel: string; onRetry: () => void } | null;
  networkUnreachableTip?: { message: string; onPress: () => void } | null;
}) {
  const { colors, elevation } = useTheme();
  const chatMessages = useMessages().chat;
  const keyboardPadding = useKeyboardListPadding();
  const showLoadingIndicator = useDelayedLoadingIndicator(loading);
  const listRef = useRef<FlashListRef<Message>>(null);
  const lastMessageIndex = messages.length - 1;
  const latestAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === 'assistant') return index;
    }
    return -1;
  }, [messages]);

  const {
    listKey,
    showScrollToBottom,
    scrollToBottom,
    onScroll,
    onContentSizeChange,
    onLayout,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
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
      const isLast = index === lastMessageIndex;
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
            reasoningLevel={reasoningLevel}
            messageIndex={index}
            isLatestAssistant={index === latestAssistantIndex}
            isStreaming={isStreamRow}
            progress={isStreamRow ? progress : null}
            sessionKey={sessionKey}
            onUserMessageCopy={onUserMessageCopy}
            onUserMessageEdit={onUserMessageEdit}
            onUserMessageRetry={item.deliveryState === 'failed' && onUserMessageRetry
              ? () => onUserMessageRetry(item)
              : undefined}
            onAssistantCopy={onAssistantCopy}
            onAssistantSaveToNote={onAssistantSaveToNote}
            onAssistantRegenerate={
              onAssistantRegenerate && index === latestAssistantIndex
                ? () => onAssistantRegenerate(index)
                : undefined
            }
          />
        </ChatRenderErrorBoundary>
      );
    },
    [
      lastMessageIndex,
      latestAssistantIndex,
      reasoningLevel,
      onUserMessageCopy,
      onUserMessageEdit,
      onUserMessageRetry,
      onAssistantCopy,
      onAssistantSaveToNote,
      onAssistantRegenerate,
      streaming,
      progress,
      sessionKey,
    ],
  );

  const keyExtractor = useCallback(
    (item: Message, index: number) => messageKey(item, index),
    [],
  );

  if (loading && messages.length === 0) {
    return (
      <View style={styles.center}>
        {listHeader}
        {showLoadingIndicator ? <ActivityIndicator size="large" /> : null}
      </View>
    );
  }

  if (messages.length === 0 && !streaming && loadError) {
    return (
      <View style={styles.center}>
        <Icon source="alert-circle-outline" size={36} color={colors.semantic.errorBold} />
        <Text variant="titleMedium" style={[styles.emptyTitle, { color: colors.text.primary }]}>
          {loadError.message}
        </Text>
        <Button mode="outlined" onPress={loadError.onRetry}>
          {loadError.retryLabel}
        </Button>
      </View>
    );
  }

  if (messages.length === 0 && !streaming) {
    const starters = welcomeStarters?.filter((starter) => starter.prompt.trim()) ?? [];
    const chips = starters.length > 0
      ? []
      : (suggestions?.filter(Boolean) ?? []);
    return (
      <ScrollView
        style={styles.listFlex}
        contentContainerStyle={emptyContentStyle}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {listHeader}
        <Text variant="titleMedium" style={[styles.emptyTitle, { color: colors.text.primary }]}>
          {welcomeTitle ?? chatMessages.welcomeTitle}
        </Text>
        <Text variant="bodySmall" style={[styles.emptySubtitle, { color: colors.text.secondary }]}>
          {welcomeSubtitle ?? chatMessages.welcomeSubtitle}
        </Text>
        {starters.length > 0 ? (
          <View style={styles.starterColumn}>
            {starters.map((starter) => (
              <Pressable
                key={starter.id}
                style={({ pressed }) => [
                  styles.starterRow,
                  {
                    borderColor: colors.border.default,
                    backgroundColor: pressed ? colors.surface.hover : colors.surface.panel,
                  },
                ]}
                onPress={() => onSuggestionSend?.(starter.prompt)}
                accessibilityRole="button"
              >
                <View style={[styles.starterIcon, { backgroundColor: colors.accent.selectionBg }]}>
                  <Icon source={starterIconSource(starter.icon)} size={18} color={colors.accent.primary} />
                </View>
                <View style={styles.starterText}>
                  <Text
                    variant="bodyMedium"
                    style={[styles.starterTitle, { color: colors.text.primary }]}
                    numberOfLines={1}
                  >
                    {starter.title}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={[styles.starterDescription, { color: colors.text.secondary }]}
                    numberOfLines={1}
                  >
                    {starter.description}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : chips.length > 0 ? (
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
        maintainVisibleContentPosition={CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={listContentStyle}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
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
          style={[styles.scrollToBottomButton, elevation.overlay]}
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
  starterColumn: {
    alignSelf: 'stretch',
    gap: 8,
    marginTop: 14,
    maxWidth: 360,
    width: '100%',
  },
  starterRow: {
    minHeight: 60,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  starterIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  starterTitle: {
    ...typography.ui,
  },
  starterDescription: {
    ...typography.caption,
    opacity: 0.82,
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
    bottom: 16,
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
