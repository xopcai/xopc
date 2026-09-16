import { useRouter } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { openNoteDetail } from '../../lib/navigation';
import { radii, spacing, typography, useTheme } from '../../theme';
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
  return <>
    {refs.map((ref) => <View key={`${ref.kind}:${ref.sourceId}`} style={[styles.chip, { backgroundColor: colors.accent.soft, borderColor: colors.border.subtle }]}>
      <Pressable style={styles.open} accessibilityRole="button" accessibilityLabel={copy.open.replace('{{title}}', ref.title)}
        onPress={() => ref.kind === 'task' ? router.push(`/tasks/${encodeURIComponent(ref.sourceId)}`) : openNoteDetail(router, ref.sourceId)}>
      <Icon source={ref.kind === 'task' ? 'checkbox-marked-circle-outline' : 'notebook-outline'} size={15} color={colors.accent.primary} />
      <Text numberOfLines={1} style={[styles.label, { color: colors.text.primary }]}>{ref.title}</Text>
      </Pressable>
      <Pressable style={styles.remove} accessibilityRole="button" accessibilityLabel={`${copy.remove}: ${ref.title}`} onPress={() => onRemove(ref.sourceId, ref.kind)}>
        <Icon source="close" size={14} color={colors.text.tertiary} />
      </Pressable>
    </View>)}
  </>;
});

const styles = StyleSheet.create({
  chip: { maxWidth: 220, minHeight: 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.full, paddingLeft: spacing.sm },
  open: { minHeight: 44, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1, ...typography.caption },
});
