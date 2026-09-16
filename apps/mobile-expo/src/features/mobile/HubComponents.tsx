import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { spacing, typography, useTheme } from '../../theme';

export function HubSection({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={styles.section}><Text style={[styles.label, { color: colors.text.secondary }]}>{title}</Text>{children}</View>;
}

export function HubRow({ title, summary, icon, onPress }: { title: string; summary?: string; icon: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border.subtle, backgroundColor: pressed ? colors.surface.pressed : 'transparent' }]}>
    <Icon source={icon} size={23} color={colors.text.secondary} />
    <View style={styles.copy}><Text style={[styles.title, { color: colors.text.primary }]} numberOfLines={2}>{title}</Text>{summary ? <Text style={[styles.summary, { color: colors.text.secondary }]} numberOfLines={2}>{summary}</Text> : null}</View>
    <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
  </Pressable>;
}

export function HubEmpty({ text }: { text: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.empty, { color: colors.text.secondary }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.section },
  label: { ...typography.label, marginBottom: spacing.sm },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.body, fontWeight: '500' },
  summary: { ...typography.label, marginTop: spacing.xs },
  empty: { ...typography.body, paddingVertical: spacing.md },
});
