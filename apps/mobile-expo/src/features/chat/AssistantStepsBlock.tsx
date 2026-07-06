/**
 * Collapsible container for assistant execution steps (thinking + tool use).
 *
 * Behaviour mirrors web/src/features/chat/assistant-steps-block.tsx:
 * - Auto-expands while streaming (thinking or tools running)
 * - Auto-collapses when the final answer text starts flowing
 * - Can be manually toggled by tapping the header
 */
import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import {
  buildStepsRoundActiveSummary,
  buildStepsRoundCompleteSummary,
  filterVisibleSteps,
  viewStepsLabel,
} from './assistant-steps-summary';
import type { MessageContent, ThinkingContent, ToolUseContent } from './messages.types';
import { formatStepRoundDuration } from './step-round-duration';
import { chatColors } from './styles';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolUseBlock } from './ToolUseBlock';
import { useMessages } from '../../i18n/messages';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useTheme } from '../../theme';

/** Check if any step block is still active (streaming thinking or running tool). */
export function isAnyBlockActive(blocks: Array<ThinkingContent | ToolUseContent>): boolean {
  return blocks.some(
    (b) =>
      (b.type === 'thinking' && b.streaming) ||
      (b.type === 'tool_use' && b.status === 'running'),
  );
}

const StepRoundDurationText = memo(function StepRoundDurationText({
  active,
  roundStartRef,
  frozenMs,
}: {
  active: boolean;
  roundStartRef: MutableRefObject<number | null>;
  frozenMs: number | null;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [active]);

  const startedAt = roundStartRef.current;
  const elapsedMs = active && startedAt != null ? Math.max(0, Date.now() - startedAt) : 0;
  const text =
    active && startedAt != null
      ? formatStepRoundDuration(elapsedMs, language)
      : frozenMs != null
        ? formatStepRoundDuration(frozenMs, language)
        : null;

  if (!text) return null;

  return (
    <Text variant="labelSmall" style={styles.durationText}>
      {text}
    </Text>
  );
});

export const AssistantStepsBlock = memo(function AssistantStepsBlock({
  blocks,
  isMessageStreaming,
  finalAnswerStarted,
  sessionKey,
}: {
  /** Consecutive thinking + tool_use content blocks. */
  blocks: Array<ThinkingContent | ToolUseContent>;
  /** Whether the parent message is still streaming. */
  isMessageStreaming: boolean;
  /** True once assistant text content appears after these step blocks. */
  finalAnswerStarted: boolean;
  sessionKey?: string | null;
}) {
  const m = useMessages();
  const language = usePreferencesStore((s) => s.language);
  const { colors, isDark } = useTheme();

  const visibleBlocks = useMemo(() => filterVisibleSteps(blocks), [blocks]);
  const stepCount = visibleBlocks.length;
  const anyActive = isAnyBlockActive(visibleBlocks);

  const stepsDrawerOpen = isMessageStreaming && !finalAnswerStarted;

  const roundStartRef = useRef<number | null>(null);
  const prevStepsDrawerOpenRef = useRef(false);
  const [frozenDurationMs, setFrozenDurationMs] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(stepsDrawerOpen);

  if (anyActive && roundStartRef.current === null) {
    roundStartRef.current = Date.now();
  }

  useEffect(() => {
    if (stepsDrawerOpen) {
      setExpanded(true);
    } else if (prevStepsDrawerOpenRef.current) {
      if (roundStartRef.current !== null) {
        setFrozenDurationMs(Date.now() - roundStartRef.current);
      }
      setExpanded(false);
    }
    prevStepsDrawerOpenRef.current = stepsDrawerOpen;
  }, [stepsDrawerOpen]);

  const stepLabels = useMemo(
    () => ({
      thoughts: m.chat.thoughts,
      thoughtsStreaming: m.chat.thoughtsStreaming,
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      runCommand: m.chat.stepRunCommand,
      listDirectory: m.chat.stepListDirectory,
      writeFile: m.chat.stepWriteFile,
      editFile: m.chat.stepEditFile,
      openUrl: m.chat.stepOpenUrl,
      fetchUrl: m.chat.stepFetchUrl,
      unknownTool: m.chat.stepUnknownTool,
      stepDetails: m.chat.stepDetails,
      toolInput: m.chat.toolInput,
      toolOutput: m.chat.toolOutput,
      noOutput: m.chat.noOutput,
      toolRunning: m.chat.toolRunning,
      toolError: m.chat.toolError,
      searchResults: m.chat.searchResults,
      showMoreResults: m.chat.showMoreResults,
      showLessResults: m.chat.showLessResults,
    }),
    [m.chat],
  );

  const completedHeader = useMemo(() => {
    const fallback = viewStepsLabel(stepCount, {
      viewSteps_one: m.chat.viewSteps_one,
      viewSteps_other: m.chat.viewSteps_other,
    });

    if (anyActive) {
      return buildStepsRoundActiveSummary(
        visibleBlocks,
        {
          searchedWeb: m.chat.stepSearchedWeb,
          readFile: m.chat.stepReadFile,
          runCommand: m.chat.stepRunCommand,
          listDirectory: m.chat.stepListDirectory,
          writeFile: m.chat.stepWriteFile,
          editFile: m.chat.stepEditFile,
          openUrl: m.chat.stepOpenUrl,
          fetchUrl: m.chat.stepFetchUrl,
          unknownTool: m.chat.stepUnknownTool,
        },
        language,
        fallback,
      );
    }

    return buildStepsRoundCompleteSummary(
      visibleBlocks,
      {
        searchedWeb: m.chat.stepSearchedWeb,
        readFile: m.chat.stepReadFile,
        runCommand: m.chat.stepRunCommand,
        listDirectory: m.chat.stepListDirectory,
        writeFile: m.chat.stepWriteFile,
        editFile: m.chat.stepEditFile,
        openUrl: m.chat.stepOpenUrl,
        fetchUrl: m.chat.stepFetchUrl,
        unknownTool: m.chat.stepUnknownTool,
      },
      language,
      fallback,
    );
  }, [anyActive, visibleBlocks, language, stepCount, m.chat]);

  if (stepCount === 0) return null;

  const headerMain = completedHeader;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? chatColors.stepsBgDark : chatColors.stepsBg,
          borderColor: isDark ? chatColors.stepsBorderDark : chatColors.stepsBorder,
        },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={headerMain}
        accessibilityState={{ expanded }}
      >
        {anyActive ? (
          <ActivityIndicator size={14} color={chatColors.accent} />
        ) : (
          <Icon
            source="check-circle-outline"
            size={14}
            color={colors.semantic.success}
          />
        )}

        <View style={styles.headerCenter}>
          <Text
            variant="labelSmall"
            style={[styles.headerLabel, { color: colors.text.primary }]}
            numberOfLines={2}
          >
            {headerMain}
          </Text>
          {anyActive ? (
            <StepRoundDurationText
              active={anyActive}
              roundStartRef={roundStartRef}
              frozenMs={null}
            />
          ) : (
            <StepRoundDurationText
              active={false}
              roundStartRef={roundStartRef}
              frozenMs={frozenDurationMs}
            />
          )}
        </View>

        <Icon
          source={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.text.tertiary}
        />
      </Pressable>

      {expanded ? (
        <View
          style={[
            styles.timelineOuter,
            { borderTopColor: isDark ? chatColors.stepsBorderDark : chatColors.stepsBorder },
          ]}
        >
          <View
            style={[
              styles.timeline,
              { borderLeftColor: isDark ? chatColors.stepsTimelineDark : chatColors.stepsTimeline },
            ]}
          >
            {visibleBlocks.map((block, i) => {
              if (block.type === 'thinking') {
                return (
                  <ThinkingBlock
                    key={`thinking-${i}`}
                    text={block.text}
                    streaming={block.streaming}
                    inline
                    labels={{
                      thoughts: stepLabels.thoughts,
                      thoughtsStreaming: stepLabels.thoughtsStreaming,
                    }}
                  />
                );
              }
              return (
                <ToolUseBlock
                  key={`tool-${block.id || i}`}
                  block={block}
                  inline
                  sessionKey={sessionKey}
                  labels={stepLabels}
                  showWorkspaceArtifacts={!isMessageStreaming}
                />
              );
            })}
          </View>
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
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 12,
    marginVertical: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 16,
  },
  durationText: {
    fontSize: 11,
    color: chatColors.timestamp,
    fontVariant: ['tabular-nums'],
  },
  timelineOuter: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timeline: {
    marginLeft: 4,
    borderLeftWidth: 2,
    paddingLeft: 12,
    gap: 12,
  },
});
