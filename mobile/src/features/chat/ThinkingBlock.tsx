/**
 * Thinking/reasoning block for assistant messages.
 *
 * Two modes:
 * - **standalone** (default): wrapped in its own collapsible card with border.
 * - **inline** (`inline={true}`): compact row inside an AssistantStepsBlock timeline.
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { chatColors } from './styles';

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming,
  inline,
}: {
  text: string;
  streaming?: boolean;
  /** When true, renders as a compact row inside AssistantStepsBlock. */
  inline?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDark = useColorScheme() === 'dark';
  const trimmed = (text || '').trim();
  const hasContent = trimmed.length > 0;

  const label = streaming ? 'Thinking…' : 'Thoughts';

  // ── Inline mode: compact row for AssistantStepsBlock timeline ──
  if (inline) {
    const preview = hasContent ? trimmed.slice(0, 120) : '';
    return (
      <View style={inlineStyles.row}>
        <View style={inlineStyles.iconCol}>
          {streaming ? (
            <ActivityIndicator size={12} color={isDark ? '#9CA3AF' : '#6B7280'} />
          ) : (
            <Icon
              source="check-circle-outline"
              size={14}
              color={isDark ? '#22C55E' : '#16A34A'}
            />
          )}
        </View>
        <View style={inlineStyles.content}>
          <Text
            variant="labelSmall"
            style={[inlineStyles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}
          >
            {label}
          </Text>
          {preview ? (
            <Text
              variant="bodySmall"
              numberOfLines={3}
              style={{ color: isDark ? '#9CA3AF' : '#6B7280', fontSize: 11, lineHeight: 16 }}
            >
              {preview}
            </Text>
          ) : streaming ? (
            <Text
              variant="bodySmall"
              style={{ color: isDark ? '#6B7280' : '#9CA3AF', fontSize: 11 }}
            >
              …
            </Text>
          ) : null}
        </View>
      </View>
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
          color={isDark ? '#9CA3AF' : '#6B7280'}
        />
        <Text variant="labelSmall" style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
          {label}
        </Text>
        {hasContent ? (
          <Icon
            source={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={isDark ? '#9CA3AF' : '#6B7280'}
          />
        ) : null}
        {preview && !expanded ? (
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={[styles.preview, { color: isDark ? '#6B7280' : '#9CA3AF' }]}
          >
            {preview}
          </Text>
        ) : null}
      </Pressable>
      {expanded && hasContent ? (
        <View style={styles.body}>
          <Text
            variant="bodySmall"
            style={{ color: isDark ? '#D1D5DB' : '#4B5563', lineHeight: 18 }}
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
  },
  iconCol: {
    paddingTop: 1,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontWeight: '500',
    fontSize: 12,
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
