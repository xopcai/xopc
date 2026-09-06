/**
 * Chat message bubble — user or assistant.
 *
 * User messages: right-aligned, tinted background, plain text.
 * Assistant messages: left-aligned, markdown rendering, thinking/tool blocks.
 */
import { memo, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useRouter } from 'expo-router';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AssistantStepsBlock } from './AssistantStepsBlock';
import { AssistantDeliverablesCard } from './AssistantDeliverablesCard';
import { AttachmentRenderer } from './AttachmentRenderer';
import { AudioMessageBlock } from './AudioMessageBlock';
import { MarkdownView } from './MarkdownView';
import { extractMarkdownCodeBlocks } from './extract-markdown-code';
import { MessageActionsBar, type MessageAction } from './MessageActionsBar';
import type {
  Message,
  MessageContent,
  ProgressState,
  ReasoningLevel,
  ReviewContent,
} from './messages.types';
import { useMessages } from '../../i18n/messages';
import { colors as tokenColors, typography, useTheme } from '../../theme';
import { extractUserMessageText } from './composer-send-helpers';
import { chatColors, chatLayout } from './styles';
import { usePreferencesStore } from '../../stores/preferences-store';
import { buildSpeakableText, detectSpeechLanguage } from '../voice/read-aloud-text';
import { useReadAloudStore } from '../voice/read-aloud-store';
import {
  assistantTextForDisplay,
  getAssistantFinalResultText,
  isAssistantNarration,
} from './assistant-text-presentation';
import {
  buildAssistantTurnViewModel,
  type AssistantActivityPresentation,
} from './assistant-turn-view-model';
import { openNoteDetail } from '../../lib/navigation';
import { motion, useReducedMotion } from '../../motion';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function StreamingCursor() {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0.72);

  useEffect(() => {
    cancelAnimation(opacity);
    if (reducedMotion) {
      opacity.value = 0.72;
      return;
    }
    opacity.value = withRepeat(
      withTiming(0.28, {
        duration: motion.duration.ambient,
        easing: motion.easing.enter,
      }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.cursor}>
      <Animated.View
        style={[styles.cursorDot, { backgroundColor: chatColors.cursorBlink }, animatedStyle]}
      />
    </View>
  );
}

/**
 * Detect garbled / mojibake text that results from encoding mismatches
 * (e.g. GBK bytes decoded as Latin-1 then stored in UTF-8 JSON).
 *
 * Heuristic: if a significant portion of the text contains Unicode replacement
 * characters (U+FFFD) or characters from the Latin-1 Supplement block
 * (U+0080–U+00FF) that look like mojibake, flag it.
 *
 * Thresholds are intentionally generous to avoid false positives on normal
 * text that happens to contain a few accented characters.
 */
function isGarbledText(text: string): boolean {
  if (!text || text.length < 20) return false;

  // Count suspicious characters:
  // - U+FFFD: Unicode replacement character
  // - U+0080–U+00FF: Latin-1 Supplement (common mojibake range)
  // - Consecutive non-printable control characters
  let suspicious = 0;
  const len = Math.min(text.length, 500); // sample first 500 chars
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    if (
      code === 0xFFFD || // replacement char
      (code >= 0x0080 && code <= 0x00FF) || // Latin-1 supplement (mojibake)
      (code < 0x0020 && code !== 0x000A && code !== 0x000D && code !== 0x0009) // non-printable
    ) {
      suspicious++;
    }
  }

  // If more than 30% of sampled chars are suspicious, it's garbled
  return suspicious / len > 0.3;
}

const GARBLED_PLACEHOLDER = '⚠️ Content encoding error — text cannot be displayed correctly.';

const garbledStyles = StyleSheet.create({
	  notice: {
	    ...typography.label,
	    fontStyle: 'italic',
	    color: tokenColors.light.text.secondary,
	    paddingVertical: 4,
	  },
});

/** Extract all text blocks into a single string for user display. */
function userContentText(content: MessageContent[]): string {
  return extractUserMessageText(content);
}

function userAudioBlocks(content: MessageContent[]): Extract<MessageContent, { type: 'audio' }>[] {
  return content.filter((b): b is Extract<MessageContent, { type: 'audio' }> => b.type === 'audio');
}

function reviewLocation(finding: ReviewContent['findings'][number]): string {
  if (!finding.filePath) return '';
  if (!finding.lineStart) return finding.filePath;
  const end = finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : '';
  return `${finding.filePath}:${finding.lineStart}${end}`;
}

function ReviewBlock({ review }: { review: ReviewContent }) {
  const { colors, isDark } = useTheme();
  const correctnessColor =
    review.overallCorrectness === 'patch is incorrect'
      ? '#b91c1c'
      : review.overallCorrectness === 'patch is correct'
        ? '#047857'
        : colors.text.secondary;
  return (
    <View style={[styles.reviewCard, { borderColor: colors.border.default }]}>
      <View style={styles.reviewHeader}>
        <Text style={[styles.reviewTitle, { color: colors.text.primary }]}>Code review</Text>
        <Text
          style={[
            styles.reviewBadge,
            {
              color: correctnessColor,
              borderColor: isDark ? colors.border.default : '#d1d5db',
            },
          ]}
        >
          {review.overallCorrectness}
        </Text>
      </View>
      {review.summary ? (
        <Text style={[styles.reviewSummary, { color: colors.text.secondary }]}>{review.summary}</Text>
      ) : null}
      <View style={styles.reviewFindings}>
        {review.findings.length === 0 ? (
          <Text style={[styles.reviewBody, { color: colors.text.secondary }]}>No findings.</Text>
        ) : (
          review.findings.map((finding, index) => {
            const loc = reviewLocation(finding);
            return (
              <View
                key={`${finding.title}-${index}`}
                style={[styles.reviewFinding, { borderColor: colors.border.default }]}
              >
                <View style={styles.reviewFindingHeader}>
                  <Text style={[styles.reviewPriority, { color: colors.text.secondary, borderColor: colors.border.default }]}>
                    P{finding.priority}
                  </Text>
                  <Text style={[styles.reviewFindingTitle, { color: colors.text.primary }]}>
                    {finding.title}
                  </Text>
                </View>
                {loc ? <Text style={[styles.reviewLocation, { color: colors.text.secondary }]}>{loc}</Text> : null}
                {finding.body ? <Text style={[styles.reviewBody, { color: colors.text.secondary }]}>{finding.body}</Text> : null}
              </View>
            );
          })
        )}
      </View>
      {review.overallExplanation ? (
        <Text style={[styles.reviewBody, { color: colors.text.secondary }]}>{review.overallExplanation}</Text>
      ) : null}
    </View>
  );
}

/**
 * Render content blocks for an assistant message.
 *
 * Consecutive thinking + tool_use blocks are grouped into a single
 * AssistantStepsBlock that auto-expands during streaming and collapses
 * once the final answer text starts flowing — matching web chat behaviour.
 */
function renderAssistantContent(
  content: MessageContent[],
  isStreaming: boolean,
  activity: AssistantActivityPresentation,
  showStreamingCursor: boolean,
  sessionKey?: string | null,
  allowTrailingMargin = false,
) {
  const nodes: React.ReactNode[] = [];
  let activityRendered = false;
  let narrationRendered = false;
  let i = 0;

  while (i < content.length) {
    const block = content[i];

    if (block.type === 'thinking' || block.type === 'tool_use') {
      if (!activityRendered && activity.blocks.length > 0) {
        nodes.push(
          <AssistantStepsBlock
            key="turn-activity"
            blocks={activity.blocks}
            isMessageStreaming={isStreaming}
            expandedByDefault={activity.expandedByDefault}
          />,
        );
        activityRendered = true;
      }
      i++;
    } else if (block.type === 'text') {
      if (isAssistantNarration(block)) {
        if (narrationRendered) {
          i++;
          continue;
        }
        narrationRendered = true;
      }
      let merged = assistantTextForDisplay(block);
      let j = i + 1;
      while (j < content.length) {
        const next = content[j];
        if (
          next.type !== 'text'
          || next.presentation !== block.presentation
          || isAssistantNarration(next)
        ) break;
        merged += '\n' + assistantTextForDisplay(next);
        j++;
      }
      if (merged.trim()) {
        if (isGarbledText(merged)) {
          nodes.push(
            <Text key={`garbled-${i}`} style={garbledStyles.notice}>
              {GARBLED_PLACEHOLDER}
            </Text>,
          );
        } else {
          nodes.push(
            <MarkdownView
              key={`text-${i}`}
              content={merged}
              streaming={isStreaming}
              allowTrailingMargin={allowTrailingMargin}
            />,
          );
        }
      }
      i = j;
    } else if (block.type === 'image') {
      // Assistant images are shown in the dedicated artifact strip below the answer.
      i++;
    } else if (block.type === 'audio') {
      if (!isStreaming) {
        nodes.push(<AudioMessageBlock key={`audio-${i}`} audio={block} sessionKey={sessionKey} />);
      }
      i++;
    } else if (block.type === 'review') {
      nodes.push(<ReviewBlock key={`review-${i}`} review={block} />);
      i++;
    } else {
      i++;
    }
  }

  // Streaming cursor: show blinking indicator while waiting or at the end of streamed content
  if (showStreamingCursor) {
    nodes.push(<StreamingCursor key="cursor" />);
  }

  return nodes;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  reasoningLevel = 'on',
  messageIndex,
  isLatestAssistant = false,
  isStreaming = false,
  progress,
  sessionKey,
  onUserMessageCopy,
  onUserMessageEdit,
  onUserMessageRetry,
  onAssistantCopy,
  onAssistantSaveToNote,
  onAssistantRegenerate,
}: {
  message: Message;
  reasoningLevel?: ReasoningLevel;
  messageIndex: number;
  isLatestAssistant?: boolean;
  isStreaming?: boolean;
  progress?: ProgressState | null;
  sessionKey?: string;
  onUserMessageCopy?: (text: string) => void;
  onUserMessageEdit?: (text: string) => void;
  onUserMessageRetry?: () => void;
  onAssistantCopy?: (text: string) => void;
  onAssistantSaveToNote?: (text: string) => void;
  onAssistantRegenerate?: () => void;
}) {
  const m = useMessages();
  const router = useRouter();
  const language = usePreferencesStore((state) => state.language);
  const { colors, isDark } = useTheme();
  const isUser = message.role === 'user' || message.role === 'user-with-attachments';
  const isAssistant = message.role === 'assistant';
  const contentBlocks = message.content ?? [];
  const assistantTurnView = useMemo(
    () => isAssistant
      ? buildAssistantTurnViewModel({ message, isStreaming, reasoningLevel })
      : null,
    [isAssistant, isStreaming, message, reasoningLevel],
  );

  const userText = useMemo(
    () => (isUser ? userContentText(contentBlocks) : ''),
    [isUser, contentBlocks],
  );

  const userAudio = useMemo(
    () => (isUser ? userAudioBlocks(contentBlocks) : []),
    [isUser, contentBlocks],
  );

  const userAttachments = useMemo(() => {
    const attachments = message.attachments ?? [];
    if (!userAudio.length) return attachments;
    return attachments.filter(attachment => attachment.type !== 'voice'
      && attachment.type !== 'audio' && !attachment.mimeType?.startsWith('audio/'));
  }, [message.attachments, userAudio.length]);

  const displayContent = useMemo(
    () => (isAssistant
      ? (assistantTurnView?.displayContent ?? contentBlocks).filter((b) => b.type !== 'image')
      : contentBlocks),
    [assistantTurnView?.displayContent, isAssistant, contentBlocks],
  );

  const showAssistantDeliverables = Boolean(
    assistantTurnView && (
      assistantTurnView.deliverables.awaiting
      || assistantTurnView.deliverables.artifacts.length > 0
      || assistantTurnView.deliverables.productDeliveries.length > 0
    ),
  );

  const stepsActive = Boolean(assistantTurnView?.activity.active);
  const progressForMeta = reasoningLevel === 'off'
    || Boolean(assistantTurnView?.activity.blocks.length)
    ? null
    : progress;

  const showProgressDetail =
    Boolean(progressForMeta?.detail?.trim()) &&
    progressForMeta?.detail?.trim() !== progressForMeta?.message?.trim();

  const showMetaFallbackThinking =
    isStreaming &&
    !progressForMeta?.message &&
    !stepsActive &&
    !contentBlocks.some((b) => b.type === 'thinking' && b.streaming);

  const showMeta =
    Boolean(message.timestamp) ||
    Boolean(message.deliveryState) ||
    Boolean(progressForMeta?.message) ||
    showProgressDetail ||
    showMetaFallbackThinking;

  const assistantPlainText = useMemo(() => {
    if (!isAssistant) return '';
    return contentBlocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }, [isAssistant, contentBlocks]);

  const assistantFinalResultText = useMemo(
    () => (isAssistant ? getAssistantFinalResultText(contentBlocks) : ''),
    [contentBlocks, isAssistant],
  );

  const assistantCodeText = useMemo(
    () => (assistantPlainText ? extractMarkdownCodeBlocks(assistantPlainText) : ''),
    [assistantPlainText],
  );
  const hasAssistantAudio = isAssistant && contentBlocks.some((block) => block.type === 'audio');
  const speakableText = useMemo(
    () => (assistantFinalResultText ? buildSpeakableText(assistantFinalResultText) : ''),
    [assistantFinalResultText],
  );
  const readAloudSourceId = `${sessionKey ?? 'chat'}:${message.id ?? message.timestamp ?? messageIndex}`;
  const readAloudStatus = useReadAloudStore((state) => (
    state.source?.id === readAloudSourceId ? state.status : 'idle'
  ));
  const requestReadAloud = useReadAloudStore((state) => state.requestStart);
  const enableContinuousReadAloud = useReadAloudStore((state) => state.enableContinuous);

  const userActions = useMemo((): MessageAction[] => {
    if (!isUser) return [];
    const actions: MessageAction[] = [];
    if (message.deliveryState === 'failed' && onUserMessageRetry) {
      actions.push({
        icon: 'refresh',
        onPress: onUserMessageRetry,
        accessibilityLabel: m.chat.messageRetry,
      });
    }
    if (userText.trim() && onUserMessageEdit) {
      actions.push({
        icon: 'pencil-outline',
        onPress: () => onUserMessageEdit(userText),
        accessibilityLabel: m.chat.messageEdit,
      });
    }
    if (userText.trim() && onUserMessageCopy) {
      actions.push({
        icon: 'content-copy',
        onPress: () => onUserMessageCopy(userText),
        accessibilityLabel: m.chat.messageCopy,
      });
    }
    return actions;
  }, [
    isUser,
    userText,
    message.deliveryState,
    onUserMessageEdit,
    onUserMessageCopy,
    onUserMessageRetry,
    m.chat.messageEdit,
    m.chat.messageCopy,
    m.chat.messageRetry,
  ]);

  const assistantActions = useMemo((): MessageAction[] => {
    if (!isAssistant || isStreaming) return [];
    if (!assistantPlainText && !onAssistantRegenerate) return [];
    const actions: MessageAction[] = [];
    if (onAssistantCopy) {
      actions.push({
        icon: 'content-copy',
        onPress: () => onAssistantCopy(assistantPlainText),
        accessibilityLabel: m.chat.messageCopy,
      });
    }
    if (speakableText && !hasAssistantAudio) {
      const label = readAloudStatus === 'preparing'
        ? m.chat.messageReadAloudPreparing
        : readAloudStatus === 'playing'
          ? m.chat.messageReadAloudPause
          : readAloudStatus === 'paused'
            ? m.chat.messageReadAloudResume
            : readAloudStatus === 'error'
              ? m.chat.messageReadAloudRetry
              : m.chat.messageReadAloud;
      actions.push({
        icon: readAloudStatus === 'preparing'
          ? 'loading'
          : readAloudStatus === 'playing'
            ? 'pause'
            : readAloudStatus === 'error'
              ? 'refresh'
              : 'volume-high',
        onPress: () => {
          if (isLatestAssistant && sessionKey) enableContinuousReadAloud(sessionKey);
          requestReadAloud({
            source: {
              id: readAloudSourceId,
              sessionKey,
              title: m.chat.messageReadAloudTitle,
              preview: speakableText,
            },
            text: speakableText,
            language: detectSpeechLanguage(speakableText, language),
          });
        },
        accessibilityLabel: label,
      });
    }
    if (assistantPlainText && onAssistantSaveToNote) {
      actions.push({
        icon: 'note-plus-outline',
        onPress: () => onAssistantSaveToNote(assistantPlainText),
        accessibilityLabel: m.chat.messageSaveToNote,
      });
    }
    if (assistantCodeText && onAssistantCopy) {
      actions.push({
        icon: 'file-code-outline',
        onPress: () => onAssistantCopy(assistantCodeText),
        accessibilityLabel: m.chat.messageCopyCode,
      });
    }
    if (onAssistantRegenerate) {
      actions.push({
        icon: 'refresh',
        onPress: onAssistantRegenerate,
        accessibilityLabel: m.chat.messageRegenerate,
      });
    }
    return actions;
  }, [
    isAssistant,
    isStreaming,
    assistantPlainText,
    assistantCodeText,
    speakableText,
    hasAssistantAudio,
    readAloudStatus,
    readAloudSourceId,
    requestReadAloud,
    enableContinuousReadAloud,
    isLatestAssistant,
    sessionKey,
    language,
    onAssistantCopy,
    onAssistantSaveToNote,
    onAssistantRegenerate,
    m.chat.messageCopy,
    m.chat.messageCopyCode,
    m.chat.messageSaveToNote,
    m.chat.messageReadAloud,
    m.chat.messageReadAloudPause,
    m.chat.messageReadAloudPreparing,
    m.chat.messageReadAloudResume,
    m.chat.messageReadAloudRetry,
    m.chat.messageReadAloudTitle,
    m.chat.messageRegenerate,
  ]);

  return (
    <View style={chatLayout.messageBubbleRow}>
      {/* Timestamp / progress meta */}
      {showMeta ? (
        <View style={[styles.metaRow, isUser && styles.metaRowUser]}>
          {message.timestamp ? (
            <Text variant="labelSmall" style={styles.metaTime}>
              {formatTime(message.timestamp)}
            </Text>
          ) : null}
          {message.deliveryState && message.deliveryState !== 'sent' ? (
            <Text
              variant="labelSmall"
              style={[
                styles.metaTime,
                message.deliveryState === 'failed' && { color: colors.semantic.errorBold },
              ]}
            >
              {message.deliveryState === 'failed' ? m.chat.sendFailed : m.chat.sendingMessage}
            </Text>
          ) : null}
          {progressForMeta?.message || showProgressDetail || showMetaFallbackThinking ? (
            <View style={styles.metaProgressCol}>
              {progressForMeta?.message ? (
                <Text variant="labelSmall" style={styles.metaProgress} numberOfLines={1}>
                  {progressForMeta.message}
                </Text>
              ) : null}
              {showProgressDetail ? (
                <Text variant="labelSmall" style={styles.metaProgressDetail} numberOfLines={2}>
                  {progressForMeta?.detail}
                </Text>
              ) : null}
              {showMetaFallbackThinking ? (
                <Text variant="labelSmall" style={styles.metaProgress}>
                  {m.chat.thinking}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Bubble */}
      {isUser ? (
        <View style={chatLayout.userBubbleContainer}>
          <View
            style={[
              chatLayout.userBubble,
              {
                backgroundColor: isDark
                  ? chatColors.userBubbleBgDark
                  : chatColors.userBubbleBg,
              },
            ]}
          >
            {message.contextRefs?.length ? (
              <View style={styles.noteReferenceList} accessibilityLabel={m.chat.referencedNotes}>
                {message.contextRefs.map((ref) => (
                  <Pressable
                    key={`${ref.kind}:${ref.sourceId}`}
                    accessibilityRole="button"
                    accessibilityLabel={m.chat.openReferencedNote.replace('{{title}}', ref.title)}
                    onPress={() => openNoteDetail(router, ref.sourceId)}
                    style={({ pressed }) => [
                      styles.noteReferenceCard,
                      {
                        borderColor: pressed ? colors.accent.primary : colors.border.default,
                        backgroundColor: colors.surface.panel,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.noteReferenceIcon, { backgroundColor: colors.accent.soft }]}>
                      <Icon source="note-text-outline" size={18} color={colors.accent.primary} />
                    </View>
                    <View style={styles.noteReferenceText}>
                      <Text style={[styles.noteReferenceKind, { color: colors.text.secondary }]}>
                        {m.chat.referencedNote}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.noteReferenceTitle, { color: colors.text.primary }]}
                      >
                        {ref.title}
                      </Text>
                    </View>
                    <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {userAudio.length > 0 ? (
              <View style={styles.userVoiceStack}>
                {userAudio.map((block, i) => (
                  <AudioMessageBlock
                    key={`user-audio-${i}`}
                    audio={block}
                    sessionKey={sessionKey}
                    align="end"
                  />
                ))}
              </View>
            ) : null}
            {userText ? (
              <Text
                selectable
                style={{
                  color: colors.text.primary,
                  ...typography.body,
                }}
              >
                {userText}
              </Text>
            ) : null}
            {userAttachments.length ? (
              <AttachmentRenderer attachments={userAttachments} sessionKey={sessionKey} compact />
            ) : null}
          </View>
          <MessageActionsBar actions={userActions} align="right" />
        </View>
      ) : (
        <View style={chatLayout.assistantBubbleContainer}>
          <View
            style={[
              chatLayout.assistantBubble,
              {
                backgroundColor: isDark
                  ? chatColors.assistantBgDark
                  : chatColors.assistantBg,
              },
            ]}
          >
            {renderAssistantContent(
              displayContent,
              isStreaming,
              assistantTurnView?.activity ?? { blocks: [], active: false, expandedByDefault: false },
              Boolean(assistantTurnView?.showStreamingCursor),
              sessionKey,
              showAssistantDeliverables,
            )}
          </View>

          {showAssistantDeliverables && assistantTurnView ? (
            <AssistantDeliverablesCard
              deliverables={assistantTurnView.deliverables}
              sessionKey={sessionKey}
            />
          ) : null}

          <MessageActionsBar actions={assistantActions} align="left" />
        </View>
      )}

    </View>
  );
});

const styles = StyleSheet.create({
  noteReferenceList: {
    gap: 6,
  },
  noteReferenceCard: {
    minWidth: 220,
    maxWidth: 280,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  noteReferenceIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteReferenceText: {
    flex: 1,
    minWidth: 0,
  },
  noteReferenceKind: {
    ...typography.micro,
  },
  noteReferenceTitle: {
    ...typography.label,
    fontWeight: '600',
  },
  userVoiceStack: {
    alignItems: 'flex-end',
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: 2,
    flexWrap: 'wrap',
  },
  metaRowUser: {
    justifyContent: 'flex-end',
  },
  metaTime: {
    color: chatColors.timestamp,
    ...typography.micro,
  },
  metaProgress: {
    color: chatColors.timestamp,
    ...typography.micro,
    fontStyle: 'italic',
  },
  metaProgressCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  metaProgressDetail: {
    color: chatColors.timestamp,
    ...typography.caption,
    flexShrink: 1,
  },
  cursor: {
    height: 20,
    justifyContent: 'center',
  },
  cursorDot: {
    width: 2,
    height: 14,
    borderRadius: 1,
  },
  reviewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  reviewTitle: {
    ...typography.body,
    fontWeight: '700',
  },
  reviewBadge: {
    ...typography.micro,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontWeight: '700',
  },
  reviewSummary: {
    ...typography.caption,
  },
  reviewFindings: {
    gap: 8,
  },
  reviewFinding: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  reviewFindingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  reviewPriority: {
    ...typography.micro,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontWeight: '700',
  },
  reviewFindingTitle: {
    ...typography.body,
    fontWeight: '700',
    flexShrink: 1,
  },
  reviewLocation: {
    ...typography.micro,
  },
  reviewBody: {
    ...typography.caption,
  },
});
