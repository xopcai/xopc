/**
 * Chat message bubble — user or assistant.
 *
 * User messages: right-aligned, tinted background, plain text.
 * Assistant messages: left-aligned, markdown rendering, thinking/tool blocks.
 */
import { memo, useMemo } from 'react';
import { Image, StyleSheet, useColorScheme, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AssistantStepsBlock, hasTextAfterIndex } from './AssistantStepsBlock';
import { MarkdownView } from './MarkdownView';
import type { Message, MessageContent, ProgressState, ThinkingContent, ToolUseContent } from './messages.types';
import { chatColors, chatLayout } from './styles';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Strip the envelope timestamp prefix that xopc prepends for model context.
 * Format: `[YYYY-MM-DD HH:MM ...] ` — kept for the model but hidden in UI.
 */
const ENVELOPE_TIMESTAMP_RE = /^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}[^\]]*\]\s*/;
function stripEnvelopeTimestampPrefix(text: string): string {
  return text.replace(ENVELOPE_TIMESTAMP_RE, '');
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
    fontSize: 13,
    fontStyle: 'italic',
    color: '#9CA3AF',
    paddingVertical: 4,
  },
});

/** Extract all text blocks into a single string for user display. */
function userContentText(content: MessageContent[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => stripEnvelopeTimestampPrefix(b.text))
    .join('\n');
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
          nodes.push(<MarkdownView key={`text-${i}`} content={merged} streaming={isStreaming} />);
        }
      }
      i = j;
    } else if (block.type === 'image' && block.source?.data) {
      const uri = block.source.data.startsWith('data:')
        ? block.source.data
        : `data:image/png;base64,${block.source.data}`;
      nodes.push(
        <Image
          key={`img-${i}`}
          source={{ uri }}
          style={imgStyles.image}
          resizeMode="contain"
          accessibilityLabel="Generated image"
        />,
      );
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
}: {
  message: Message;
  isStreaming?: boolean;
  progress?: ProgressState | null;
}) {
  const isDark = useColorScheme() === 'dark';
  const isUser = message.role === 'user' || message.role === 'user-with-attachments';

  const userText = useMemo(
    () => (isUser ? userContentText(message.content) : ''),
    [isUser, message.content],
  );

  const showMeta =
    Boolean(message.timestamp) ||
    Boolean(progress?.message) ||
    (isStreaming && !message.content?.some((b) => b.type === 'thinking' && b.streaming));

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
          {progress?.message ? (
            <Text variant="labelSmall" style={styles.metaProgress} numberOfLines={1}>
              {progress.message}
            </Text>
          ) : null}
          {isStreaming && !progress?.message ? (
            <Text variant="labelSmall" style={styles.metaProgress}>
              Thinking…
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Bubble */}
      {isUser ? (
        <View
          style={[
            chatLayout.userBubbleContainer,
            chatLayout.userBubble,
            {
              backgroundColor: isDark
                ? chatColors.userBubbleBgDark
                : chatColors.userBubbleBg,
            },
          ]}
        >
          <Text
            selectable
            style={{
              color: isDark ? '#E5E7EB' : '#1F2937',
              fontSize: 15,
              lineHeight: 22,
            }}
          >
            {userText}
          </Text>
        </View>
      ) : (
        <View style={[chatLayout.assistantBubbleContainer, chatLayout.assistantBubble]}>
          {renderAssistantContent(message.content ?? [], isStreaming)}
        </View>
      )}

      {/* Usage badge */}
      {!isUser && message.usage?.totalTokens ? (
        <Text variant="labelSmall" style={styles.usage}>
          {message.usage.totalTokens.toLocaleString()} tokens
          {message.usage.cost != null ? ` · $${message.usage.cost.toFixed(4)}` : ''}
        </Text>
      ) : null}
    </View>
  );
});

const imgStyles = StyleSheet.create({
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginVertical: 4,
    backgroundColor: '#F3F4F6',
  },
});

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  metaRowUser: {
    justifyContent: 'flex-end',
  },
  metaTime: {
    color: chatColors.timestamp,
    fontSize: 11,
  },
  metaProgress: {
    color: chatColors.timestamp,
    fontSize: 11,
    fontStyle: 'italic',
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
  usage: {
    color: chatColors.timestamp,
    fontSize: 10,
    marginTop: 4,
    paddingHorizontal: 2,
  },
});
