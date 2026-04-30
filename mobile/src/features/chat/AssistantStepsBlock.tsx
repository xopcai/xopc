/**
 * Collapsible container for assistant execution steps (thinking + tool use).
 *
 * Behaviour mirrors web/src/features/chat/assistant-steps-block.tsx:
 * - Auto-expands while streaming (thinking or tools running)
 * - Auto-collapses when the final answer text starts flowing
 * - Can be manually toggled by tapping the header
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import type { MessageContent, ThinkingContent, ToolUseContent } from './messages.types';
import { chatColors } from './styles';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolUseBlock } from './ToolUseBlock';

/** Check if any step block is still active (streaming thinking or running tool). */
function isAnyBlockActive(blocks: Array<ThinkingContent | ToolUseContent>): boolean {
  return blocks.some(
    (b) =>
      (b.type === 'thinking' && b.streaming) ||
      (b.type === 'tool_use' && b.status === 'running'),
  );
}

/** Human-readable tool name: snake_case → Title Case. */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a compact summary for the completed steps header. */
function buildCompletedSummary(blocks: Array<ThinkingContent | ToolUseContent>): string {
  const toolBlocks = blocks.filter((b): b is ToolUseContent => b.type === 'tool_use');
  const thinkingBlocks = blocks.filter((b): b is ThinkingContent => b.type === 'thinking');

  const parts: string[] = [];

  if (thinkingBlocks.length > 0) {
    parts.push('Thought');
  }

  if (toolBlocks.length > 0) {
    // Show first tool name + count
    const firstName = formatToolName(toolBlocks[0].name);
    if (toolBlocks.length === 1) {
      parts.push(firstName);
    } else {
      parts.push(`${firstName} +${toolBlocks.length - 1}`);
    }
  }

  return parts.join(' · ') || 'Steps';
}

export const AssistantStepsBlock = memo(function AssistantStepsBlock({
  blocks,
  isMessageStreaming,
  finalAnswerStarted,
}: {
  /** Consecutive thinking + tool_use content blocks. */
  blocks: Array<ThinkingContent | ToolUseContent>;
  /** Whether the parent message is still streaming. */
  isMessageStreaming: boolean;
  /** True once assistant text content appears after these step blocks. */
  finalAnswerStarted: boolean;
}) {
  const isDark = useColorScheme() === 'dark';
  const anyActive = isAnyBlockActive(blocks);

  // Auto-expand during streaming; auto-collapse when answer text starts
  const stepsDrawerOpen = isMessageStreaming && !finalAnswerStarted;

  const prevStepsDrawerOpenRef = useRef(false);
  const [expanded, setExpanded] = useState(stepsDrawerOpen);

  useEffect(() => {
    if (stepsDrawerOpen) {
      setExpanded(true);
    } else if (prevStepsDrawerOpenRef.current) {
      // Was open, now should close → collapse
      setExpanded(false);
    }
    prevStepsDrawerOpenRef.current = stepsDrawerOpen;
  }, [stepsDrawerOpen]);

  const stepCount = blocks.length;
  if (stepCount === 0) return null;

  const headerLabel = anyActive
    ? `Running (${stepCount} steps)…`
    : buildCompletedSummary(blocks);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB',
        },
      ]}
    >
      {/* Header — always visible */}
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={headerLabel}
        accessibilityState={{ expanded }}
      >
        {/* Status icon */}
        {anyActive ? (
          <ActivityIndicator size={14} color={chatColors.accent} />
        ) : (
          <Icon
            source="check-circle-outline"
            size={14}
            color={isDark ? '#22C55E' : '#16A34A'}
          />
        )}

        {/* Label */}
        <Text
          variant="labelSmall"
          style={[
            styles.headerLabel,
            { color: isDark ? '#D1D5DB' : '#374151' },
            anyActive && styles.headerLabelActive,
          ]}
          numberOfLines={1}
        >
          {headerLabel}
        </Text>

        {/* Chevron */}
        <Icon
          source={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={isDark ? '#6B7280' : '#9CA3AF'}
        />
      </Pressable>

      {/* Expanded content — timeline of steps */}
      {expanded ? (
        <View style={[styles.timeline, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB' }]}>
          {blocks.map((block, i) => {
            if (block.type === 'thinking') {
              return (
                <ThinkingBlock
                  key={`thinking-${i}`}
                  text={block.text}
                  streaming={block.streaming}
                  inline
                />
              );
            }
            return (
              <ToolUseBlock
                key={`tool-${block.id || i}`}
                block={block}
                inline
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

/**
 * Collect consecutive thinking + tool_use blocks from a content array.
 * Returns an array of "chunks": either a group of step blocks, or a single non-step block.
 */
export type ContentChunk =
  | { type: 'steps'; blocks: Array<ThinkingContent | ToolUseContent>; startIndex: number }
  | { type: 'other'; block: MessageContent; index: number };

export function chunkContentBlocks(content: MessageContent[]): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  let i = 0;

  while (i < content.length) {
    const b = content[i];
    if (b.type === 'thinking' || b.type === 'tool_use') {
      const start = i;
      const stepBlocks: Array<ThinkingContent | ToolUseContent> = [];
      while (i < content.length && (content[i].type === 'thinking' || content[i].type === 'tool_use')) {
        stepBlocks.push(content[i] as ThinkingContent | ToolUseContent);
        i++;
      }
      chunks.push({ type: 'steps', blocks: stepBlocks, startIndex: start });
    } else {
      chunks.push({ type: 'other', block: b, index: i });
      i++;
    }
  }

  return chunks;
}

/** True once assistant text exists after the given index (first answer token closes the steps drawer). */
export function hasTextAfterIndex(content: MessageContent[], afterIndex: number): boolean {
  for (let j = afterIndex; j < content.length; j++) {
    if (content[j].type === 'text' && ((content[j] as { text: string }).text ?? '').length > 0) {
      return true;
    }
  }
  return false;
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    marginVertical: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLabel: {
    flex: 1,
    fontWeight: '500',
    fontSize: 12,
  },
  headerLabelActive: {
    fontStyle: 'italic',
  },
  timeline: {
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
});
