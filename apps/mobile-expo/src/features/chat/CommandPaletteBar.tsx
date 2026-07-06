/**
 * CommandPaletteBar — inline suggestion list rendered above the input bar.
 * Lightweight autocomplete-bar style (like iOS keyboard suggestions).
 */
import { memo, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import type { PaletteItem } from './command-palette.types';

const MAX_HEIGHT = 180;

function itemIcon(kind: PaletteItem['kind']): string {
  return kind === 'skill' ? 'puzzle-outline' : 'flash-outline';
}

function HighlightedName({ name, query, accent }: { name: string; query: string; accent: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return <Text style={styles.itemName} numberOfLines={1}>{name}</Text>;
  }
  const idx = name.toLowerCase().indexOf(needle);
  if (idx < 0) {
    return <Text style={styles.itemName} numberOfLines={1}>{name}</Text>;
  }
  return (
    <Text style={styles.itemName} numberOfLines={1}>
      {name.slice(0, idx)}
      <Text style={[styles.highlight, { color: accent }]}>{name.slice(idx, idx + needle.length)}</Text>
      {name.slice(idx + needle.length)}
    </Text>
  );
}

export const CommandPaletteBar = memo(function CommandPaletteBar({
  items,
  query,
  loading,
  onSelect,
}: {
  items: PaletteItem[];
  query: string;
  loading: boolean;
  onSelect: (item: PaletteItem) => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();

  const bg = colors.surface.panel;
  const border = colors.border.default;
  const itemBg = colors.surface.input;
  const descColor = colors.text.secondary;
  const iconColor = colors.text.tertiary;

  const renderItem = useCallback(
    ({ item }: { item: PaletteItem }) => (
      <Pressable
        style={[styles.item, { backgroundColor: itemBg }]}
        onPress={() => onSelect(item)}
        android_ripple={{ color: colors.accent.selectionBg }}
      >
        <Icon source={itemIcon(item.kind)} size={18} color={iconColor} />
        <View style={styles.itemText}>
          <HighlightedName name={item.name} query={query} accent={colors.accent.primary} />
          {item.description ? (
            <Text style={[styles.itemDesc, { color: descColor }]} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    ),
    [colors.accent.primary, colors.accent.selectionBg, itemBg, iconColor, descColor, query, onSelect],
  );

  const keyExtractor = useCallback((item: PaletteItem) => item.id, []);

  if (loading && items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: bg, borderBottomColor: border }]}>
        <ActivityIndicator size="small" style={styles.loader} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: bg, borderBottomColor: border }]}>
        <Text style={[styles.empty, { color: descColor }]}>
          {m.commandPalette.noResults}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg, borderBottomColor: border }]}>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    maxHeight: MAX_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  highlight: {
    fontWeight: '700',
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 10,
  },
  loader: {
    paddingVertical: 12,
  },
});
