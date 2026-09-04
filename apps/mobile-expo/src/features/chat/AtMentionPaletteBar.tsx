import { memo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { spacing, useTheme } from '../../theme';
import type { MobileAtMentionItem } from './use-at-mention-picker';

export const AtMentionPaletteBar = memo(function AtMentionPaletteBar({ items, loading, emptyLabel, onSelect }: {
  items: MobileAtMentionItem[];
  loading: boolean;
  emptyLabel: string;
  onSelect: (item: MobileAtMentionItem) => void;
}) {
  const { colors } = useTheme();
  if (loading && items.length === 0) return <View style={styles.loading}><ActivityIndicator size="small" /></View>;
  if (!items.length) return <View style={styles.loading}><Text style={{ color: colors.text.tertiary }}>{emptyLabel}</Text></View>;
  return <FlatList
    data={items}
    keyExtractor={(item) => `${item.kind}:${item.id}`}
    keyboardShouldPersistTaps="handled"
    style={[styles.list, { backgroundColor: colors.surface.panel, borderBottomColor: colors.border.subtle }]}
    contentContainerStyle={styles.content}
    renderItem={({ item }) => <Pressable
      accessibilityRole="button"
      onPress={() => onSelect(item)}
      style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.input }]}
    >
      <Icon source={item.kind === 'note' ? 'notebook-outline' : item.isDirectory ? 'folder-outline' : 'file-outline'} size={19} color={colors.text.secondary} />
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text.primary }]}>{item.name}</Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: colors.text.tertiary }]}>{item.kind === 'note' ? item.description : item.relativePath}</Text>
      </View>
    </Pressable>}
  />;
});

const styles = StyleSheet.create({
  list: { maxHeight: 220, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { gap: spacing.xs, padding: spacing.sm },
  loading: { minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
});
