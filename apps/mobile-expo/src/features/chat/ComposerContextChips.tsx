import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { spacing, useTheme } from '../../theme';
import type { ComposerContextRef } from './composer.types';

export const ComposerContextChips = memo(function ComposerContextChips({ refs, onRemove }: {
  refs: ComposerContextRef[];
  onRemove: (sourceId: string) => void;
}) {
  const { colors } = useTheme();
  if (!refs.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
    {refs.map((ref) => <View key={ref.sourceId} style={[styles.chip, { backgroundColor: colors.accent.soft, borderColor: colors.border.subtle }]}>
      <Icon source="notebook-outline" size={15} color={colors.accent.primary} />
      <Text numberOfLines={1} style={[styles.label, { color: colors.text.primary }]}>{ref.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ref.title}`} hitSlop={8} onPress={() => onRemove(ref.sourceId)}>
        <Icon source="close" size={14} color={colors.text.tertiary} />
      </Pressable>
    </View>)}
  </ScrollView>;
});

const styles = StyleSheet.create({
  content: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  chip: { maxWidth: 220, height: 30, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: spacing.sm },
  label: { flexShrink: 1, fontSize: 12 },
});
