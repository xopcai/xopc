/**
 * Thinking/reasoning block for assistant messages.
 *
 * Two modes:
 * - **standalone** (default): wrapped in its own collapsible card with border.
 * - **inline** (`inline={true}`): compact row inside an AssistantStepsBlock timeline.
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { chatColors } from './styles';
import { useTheme } from '../../theme';

export type ThinkingBlockLabels = {
  thoughts: string;
  thoughtsStreaming: string;
};

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming,
  inline,
  labels,
}: {
  text: string;
  streaming?: boolean;
  /** When true, renders as a compact row inside AssistantStepsBlock. */
  inline?: boolean;
  labels?: ThinkingBlockLabels;
}) {
  const [expanded, setExpanded] = useState(false);
  const { colors, isDark } = useTheme();
  const muted = colors.text.secondary;
  const subtle = colors.text.tertiary;
  const bodyColor = colors.text.primary;
  const trimmed = (text || '').trim();
  const hasContent = trimmed.length > 0;

  const label = streaming
    ? (labels?.thoughtsStreaming ?? 'Thinking…')
    : (labels?.thoughts ?? 'Thoughts');

  // ── Inline mode: compact row for AssistantStepsBlock timeline ──
  if (inline) {
    const canExpand = hasContent && trimmed.length > 0;
    const showFullText = expanded && hasContent;

    return (
      <Pressable
        style={inlineStyles.row}
        onPress={canExpand ? () => setExpanded((v) => !v) : undefined}
        disabled={!canExpand}
        accessibilityRole={canExpand ? 'button' : 'text'}
        accessibilityLabel={label}
        accessibilityState={{ expanded: canExpand ? expanded : undefined }}
      >
        <View style={inlineStyles.iconCol}>
          {streaming ? (
            <ActivityIndicator size={12} color={muted} />
          ) : (
            <Icon
              source="check-circle-outline"
              size={14}
              color={colors.semantic.success}
            />
          )}
        </View>
        <View style={inlineStyles.content}>
          <Text
            variant="labelSmall"
            style={[inlineStyles.label, { color: muted }]}
          >
            {label}
          </Text>
          {showFullText ? (
            <Text
              variant="bodySmall"
              style={[inlineStyles.body, { color: muted }]}
              selectable
            >
              {trimmed}
            </Text>
          ) : hasContent ? (
            <Text
              variant="bodySmall"
              numberOfLines={4}
              style={[inlineStyles.body, { color: muted }]}
            >
              {trimmed}
            </Text>
          ) : streaming ? (
            <Text
              variant="bodySmall"
              style={[inlineStyles.body, { color: subtle }]}
            >
              …
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  // ── Standalone mode: collapsible card (original behaviour) ──
  const preview = hasContent && !expanded ? trimmed.slice(0, 80) : '';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? chatColors.thinkingBgDark : chatColors.thinkingBg,
          borderColor: isDark ? chatColors.thinkingBorderDark : chatColors.thinkingBorder,
        },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon
          source={streaming ? 'loading' : 'lightbulb-outline'}
          size={14}
          color={muted}
        />
        <Text variant="labelSmall" style={[styles.label, { color: muted }]}>
          {label}
        </Text>
        {hasContent ? (
          <Icon
            source={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={muted}
          />
        ) : null}
        {preview && !expanded ? (
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={[styles.preview, { color: subtle }]}
          >
            {preview}
          </Text>
        ) : null}
      </Pressable>
      {expanded && hasContent ? (
        <View style={styles.body}>
          <Text
            variant="bodySmall"
            style={{ color: bodyColor, lineHeight: 18 }}
            selectable
          >
            {trimmed}
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
    minWidth: 0,
  },
  iconCol: {
    paddingTop: 2,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  label: {
    fontWeight: '500',
    fontSize: 12,
  },
  body: {
    fontSize: 11,
    lineHeight: 16,
  },
});

// ── Standalone styles (collapsible card) ──
const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    fontWeight: '500',
    fontSize: 12,
  },
  preview: {
    flex: 1,
    fontSize: 11,
    marginLeft: 4,
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
});
