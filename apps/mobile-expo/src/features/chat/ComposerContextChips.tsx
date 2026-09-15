import { useRouter } from 'expo-router';
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { openNoteDetail } from '../../lib/navigation';
import { spacing, useTheme } from '../../theme';
import { useMessages } from '../../i18n/messages';
import type { ComposerContextRef } from './composer.types';

export const ComposerContextChips = memo(function ComposerContextChips({ refs, onRemove }: {
  refs: ComposerContextRef[];
  onRemove: (sourceId: string, kind: ComposerContextRef['kind']) => void;
}) {
  const router = useRouter();
  const copy = useMessages().chat.references;
  const { colors } = useTheme();
  if (!refs.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
    {refs.map((ref) => <View key={`${ref.kind}:${ref.sourceId}`} style={[styles.chip, { backgroundColor: colors.accent.soft, borderColor: colors.border.subtle }]}>
      <Pressable style={styles.open} accessibilityRole="button" accessibilityLabel={copy.open.replace('{{title}}', ref.title)}
        onPress={() => ref.kind === 'task' ? router.push(`/tasks/${encodeURIComponent(ref.sourceId)}`) : openNoteDetail(router, ref.sourceId)}>
      <Icon source={ref.kind === 'task' ? 'checkbox-marked-circle-outline' : 'notebook-outline'} size={15} color={colors.accent.primary} />
      <Text numberOfLines={1} style={[styles.label, { color: colors.text.primary }]}>{ref.title}</Text>
      </Pressable>
      <Pressable style={styles.remove} accessibilityRole="button" accessibilityLabel={`${copy.remove}: ${ref.title}`} hitSlop={8} onPress={() => onRemove(ref.sourceId, ref.kind)}>
        <Icon source="close" size={14} color={colors.text.tertiary} />
      </Pressable>
    </View>)}
  </ScrollView>;
});

const styles = StyleSheet.create({
  content: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  chip: { maxWidth: 220, height: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: spacing.sm },
  open: { minHeight: 44, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1, fontSize: 12 },
});
