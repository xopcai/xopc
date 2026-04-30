/**
 * Tool execution indicator for assistant messages.
 *
 * Two modes:
 * - **standalone** (default): wrapped in its own card with left border accent.
 * - **inline** (`inline={true}`): compact row inside an AssistantStepsBlock timeline.
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import type { ToolUseContent } from './messages.types';
import { chatColors } from './styles';

/** Human-readable tool name: convert snake_case to Title Case. */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract the most relevant detail from tool input for display. */
function getKeyDetail(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  // Try common parameter names
  const detail =
    obj?.query ?? obj?.q ?? obj?.search_term ?? obj?.searchQuery ??
    obj?.path ?? obj?.file_path ?? obj?.filepath ?? obj?.file ??
    obj?.url ?? obj?.command ?? obj?.cmd;
  if (typeof detail === 'string') {
    return detail.length > 80 ? detail.slice(0, 80) + '…' : detail;
  }
  return '';
}

function statusColor(status: ToolUseContent['status']) {
  switch (status) {
    case 'running':
      return chatColors.toolRunning;
    case 'done':
      return chatColors.toolDone;
    case 'error':
      return chatColors.toolError;
  }
}

export const ToolUseBlock = memo(function ToolUseBlock({
  block,
  inline,
}: {
  block: ToolUseContent;
  /** When true, renders as a compact row inside AssistantStepsBlock. */
  inline?: boolean;
}) {
  const isDark = useColorScheme() === 'dark';
  const [expanded, setExpanded] = useState(false);
  const color = statusColor(block.status);
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';

  const hasResult = block.result != null;
  const resultText =
    typeof block.result === 'string'
      ? block.result
      : block.result != null
        ? JSON.stringify(block.result, null, 2)
        : '';
  const resultPreview = resultText.length > 200 ? resultText.slice(0, 200) + '…' : resultText;

  const detailLine = getKeyDetail(block.input);

  // ── Inline mode: compact row for AssistantStepsBlock timeline ──
  if (inline) {
    return (
      <View style={inlineStyles.row}>
        <View style={inlineStyles.iconCol}>
          {isRunning ? (
            <ActivityIndicator size={12} color={isDark ? '#9CA3AF' : '#6B7280'} />
          ) : isError ? (
            <Icon source="close-circle-outline" size={14} color={chatColors.toolError} />
          ) : (
            <Icon source="check-circle-outline" size={14} color={isDark ? '#22C55E' : '#16A34A'} />
          )}
        </View>
        <View style={inlineStyles.content}>
          <View style={inlineStyles.titleRow}>
            <Text
              variant="labelSmall"
              style={[inlineStyles.label, { color: isDark ? '#D1D5DB' : '#374151' }]}
              numberOfLines={1}
            >
              {formatToolName(block.name)}
            </Text>
            {isRunning ? (
              <Text variant="labelSmall" style={{ fontSize: 10, color: isDark ? '#6B7280' : '#9CA3AF' }}>
                running…
              </Text>
            ) : isError ? (
              <Text variant="labelSmall" style={{ fontSize: 10, color: chatColors.toolError }}>
                error
              </Text>
            ) : null}
          </View>
          {detailLine ? (
            <Text
              variant="bodySmall"
              numberOfLines={2}
              style={{ color: isDark ? '#9CA3AF' : '#6B7280', fontSize: 11, lineHeight: 16 }}
            >
              {detailLine}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Standalone mode: card with left border accent (original behaviour) ──
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? chatColors.toolBgDark : chatColors.toolBg,
          borderLeftColor: color,
        },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => hasResult && setExpanded((v) => !v)}
        accessibilityRole={hasResult ? 'button' : 'text'}
        accessibilityLabel={`Tool: ${block.name}, status: ${block.status}`}
      >
        {isRunning ? (
          <ActivityIndicator size={12} color={color} />
        ) : isError ? (
          <Icon source="alert-circle-outline" size={14} color={color} />
        ) : (
          <Icon source="check-circle-outline" size={14} color={color} />
        )}
        <Text
          variant="labelSmall"
          style={[styles.name, { color: isDark ? '#D1D5DB' : '#374151' }]}
          numberOfLines={1}
        >
          {formatToolName(block.name)}
        </Text>
        {hasResult ? (
          <Icon
            source={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={isDark ? '#6B7280' : '#9CA3AF'}
          />
        ) : null}
      </Pressable>
      {expanded && resultText ? (
        <View style={styles.resultContainer}>
          <Text
            variant="bodySmall"
            style={[
              styles.result,
              { color: isDark ? '#9CA3AF' : '#6B7280' },
            ]}
            selectable
          >
            {resultPreview}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

// ── Inline styles (for AssistantStepsBlock timeline) ──
const inlineStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  iconCol: {
    paddingTop: 1,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontWeight: '500',
    fontSize: 12,
  },
});

// ── Standalone styles (card with left border) ──
const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 3,
    borderRadius: 6,
    marginVertical: 3,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  name: {
    flex: 1,
    fontWeight: '500',
    fontSize: 12,
  },
  resultContainer: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  result: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
});
