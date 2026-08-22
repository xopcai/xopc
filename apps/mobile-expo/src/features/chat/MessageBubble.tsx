/**
 * Chat message bubble — user or assistant.
 *
 * User messages: right-aligned, tinted background, plain text.
 * Assistant messages: left-aligned, markdown rendering, thinking/tool blocks.
 */
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AssistantStepsBlock, hasTextAfterIndex, isAnyBlockActive } from './AssistantStepsBlock';
import { AttachmentRenderer } from './AttachmentRenderer';
import { AudioMessageBlock } from './AudioMessageBlock';
import { MarkdownView } from './MarkdownView';
import { WorkspaceArtifactStrip } from './WorkspaceArtifactStrip';
import {
  collectAssistantWorkspaceOutputPaths,
  filterAssistantAttachmentsDedupedAgainstWorkspacePaths,
  imageContentBlocksToAttachments,
} from './assistant-message-artifacts';
import { extractMarkdownCodeBlocks } from './extract-markdown-code';
import { MessageActionsBar, type MessageAction } from './MessageActionsBar';
import type {
  ImageContent,
  Message,
  MessageContent,
  ProgressState,
  ReviewContent,
  ThinkingContent,
  ToolUseContent,
} from './messages.types';
import { useMessages } from '../../i18n/messages';
import { colors as tokenColors, typography, useTheme } from '../../theme';
import { extractUserMessageText } from './composer-send-helpers';
import { chatColors, chatLayout } from './styles';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
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
  sessionKey?: string | null,
  allowTrailingMargin = false,
) {
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < content.length) {
    const block = content[i];

    // ── Group consecutive thinking / tool_use blocks ──
    if (block.type === 'thinking' || block.type === 'tool_use') {
      const start = i;
      const stepBlocks: Array<ThinkingContent | ToolUseContent> = [];
      while (
        i < content.length &&
        (content[i].type === 'thinking' || content[i].type === 'tool_use')
      ) {
        stepBlocks.push(content[i] as ThinkingContent | ToolUseContent);
        i++;
      }
      if (stepBlocks.length > 0) {
        const finalAnswerStarted = hasTextAfterIndex(content, i);
        nodes.push(
          <AssistantStepsBlock
            key={`steps-${start}`}
            blocks={stepBlocks}
            isMessageStreaming={isStreaming}
            finalAnswerStarted={finalAnswerStarted}
            sessionKey={sessionKey}
          />,
        );
      }
    } else if (block.type === 'text') {
      // Merge consecutive text blocks
      let merged = block.text || '';
      let j = i + 1;
      while (j < content.length && content[j].type === 'text') {
        merged += '\n' + ((content[j] as { text: string }).text || '');
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
  if (isStreaming) {
    nodes.push(
      <View key="cursor" style={styles.cursor}>
        <View style={[styles.cursorDot, { backgroundColor: chatColors.cursorBlink }]} />
      </View>,
    );
  }

  return nodes;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
  progress,
  sessionKey,
  onUserMessageCopy,
  onUserMessageEdit,
  onUserMessageRetry,
  onAssistantCopy,
  onAssistantRegenerate,
}: {
  message: Message;
  isStreaming?: boolean;
  progress?: ProgressState | null;
  sessionKey?: string;
  onUserMessageCopy?: (text: string) => void;
  onUserMessageEdit?: (text: string) => void;
  onUserMessageRetry?: () => void;
  onAssistantCopy?: (text: string) => void;
  onAssistantRegenerate?: () => void;
}) {
  const m = useMessages();
  const { colors, isDark } = useTheme();
  const isUser = message.role === 'user' || message.role === 'user-with-attachments';
  const isAssistant = message.role === 'assistant';
  const contentBlocks = message.content ?? [];

  const userText = useMemo(
    () => (isUser ? userContentText(contentBlocks) : ''),
    [isUser, contentBlocks],
  );

  const userAudio = useMemo(
    () => (isUser ? userAudioBlocks(contentBlocks) : []),
    [isUser, contentBlocks],
  );

  const displayContent = useMemo(
    () => (isAssistant ? contentBlocks.filter((b) => b.type !== 'image') : contentBlocks),
    [isAssistant, contentBlocks],
  );

  const assistantWorkspacePaths = useMemo(
    () => (isAssistant ? collectAssistantWorkspaceOutputPaths(contentBlocks) : []),
    [isAssistant, contentBlocks],
  );

  const assistantImageBlocks = useMemo(
    () =>
      isAssistant
        ? contentBlocks.filter((b): b is ImageContent => b.type === 'image' && Boolean(b.source?.data))
        : [],
    [isAssistant, contentBlocks],
  );

  const assistantImageAttachments = useMemo(
    () => (isAssistant ? imageContentBlocksToAttachments(assistantImageBlocks) : []),
    [isAssistant, assistantImageBlocks],
  );

  const showAssistantArtifacts =
    isAssistant && !isStreaming && (assistantWorkspacePaths.length > 0 || assistantImageAttachments.length > 0);

  const stepsActive = useMemo(() => {
    if (!isAssistant || !isStreaming) return false;
    const stepBlocks = contentBlocks.filter(
      (b): b is ThinkingContent | ToolUseContent => b.type === 'thinking' || b.type === 'tool_use',
    );
    return isAnyBlockActive(stepBlocks);
  }, [isAssistant, isStreaming, contentBlocks]);

  const showProgressDetail =
    Boolean(progress?.detail?.trim()) &&
    progress?.detail?.trim() !== progress?.message?.trim();

  const showMetaFallbackThinking =
    isStreaming &&
    !progress?.message &&
    !stepsActive &&
    !contentBlocks.some((b) => b.type === 'thinking' && b.streaming);

  const attachmentsForBubble = useMemo(() => {
    if (!isAssistant) return message.attachments;
    return filterAssistantAttachmentsDedupedAgainstWorkspacePaths(message.attachments, assistantWorkspacePaths);
  }, [isAssistant, message.attachments, assistantWorkspacePaths]);

  const showMeta =
    Boolean(message.timestamp) ||
    Boolean(message.deliveryState) ||
    Boolean(progress?.message) ||
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

  const assistantCodeText = useMemo(
    () => (assistantPlainText ? extractMarkdownCodeBlocks(assistantPlainText) : ''),
    [assistantPlainText],
  );

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
    onAssistantCopy,
    onAssistantRegenerate,
    m.chat.messageCopy,
    m.chat.messageCopyCode,
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
          {message.deliveryState ? (
            <Text
              variant="labelSmall"
              style={[
                styles.metaTime,
                message.deliveryState === 'failed' && { color: colors.semantic.errorBold },
              ]}
            >
              {message.deliveryState === 'failed' ? m.chat.sendFailed : m.chat.waitingToSend}
            </Text>
          ) : null}
          {progress?.message || showProgressDetail || showMetaFallbackThinking ? (
            <View style={styles.metaProgressCol}>
              {progress?.message ? (
                <Text variant="labelSmall" style={styles.metaProgress} numberOfLines={1}>
                  {progress.message}
                </Text>
              ) : null}
              {showProgressDetail ? (
                <Text variant="labelSmall" style={styles.metaProgressDetail} numberOfLines={2}>
                  {progress?.detail}
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
            {attachmentsForBubble?.length ? (
              <AttachmentRenderer attachments={attachmentsForBubble} sessionKey={sessionKey} compact />
            ) : null}
          </View>
          <MessageActionsBar actions={userActions} align="right" />
        </View>
      ) : (
        <View style={chatLayout.assistantBubbleContainer}>
          <View
            style={[
              chatLayout.assistantBubble,
              showAssistantArtifacts ? styles.markdownAboveArtifacts : null,
              {
                backgroundColor: isDark
                  ? chatColors.assistantBgDark
                  : chatColors.assistantBg,
              },
            ]}
          >
            {renderAssistantContent(displayContent, isStreaming, sessionKey, showAssistantArtifacts)}

            {attachmentsForBubble?.length ? (
              <AttachmentRenderer attachments={attachmentsForBubble} sessionKey={sessionKey} />
            ) : null}
          </View>

          {showAssistantArtifacts ? (
            <View
              style={[
                styles.artifactCard,
                {
                  backgroundColor: colors.surface.panel,
	                  borderColor: colors.border.default,
                },
              ]}
            >
	              <Text style={[styles.artifactTitle, { color: colors.text.secondary }]}>
                {m.chat.messageArtifactsHeading}
              </Text>
              <View style={styles.artifactBody}>
                {assistantWorkspacePaths.length > 0 ? (
                  <WorkspaceArtifactStrip paths={assistantWorkspacePaths} sessionKey={sessionKey} />
                ) : null}
                {assistantImageAttachments.length > 0 ? (
                  <AttachmentRenderer attachments={assistantImageAttachments} sessionKey={sessionKey} compact />
                ) : null}
              </View>
            </View>
          ) : null}

          <MessageActionsBar actions={assistantActions} align="left" />
        </View>
      )}

      {/* Usage badge */}
      {!isUser && message.usage?.totalTokens ? (
        <Text variant="labelSmall" style={styles.usage}>
          {message.usage.totalTokens.toLocaleString()} tokens
          {typeof message.usage.cost === 'number' ? ` · $${message.usage.cost.toFixed(4)}` : ''}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
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
    opacity: 0.7,
  },
  markdownAboveArtifacts: {
    paddingBottom: 4,
  },
  artifactCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    gap: 8,
  },
  artifactTitle: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  artifactBody: {
    gap: 8,
  },
  usage: {
    color: chatColors.timestamp,
    ...typography.micro,
    marginTop: 4,
    paddingHorizontal: 2,
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
