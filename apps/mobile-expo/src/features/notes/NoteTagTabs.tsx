import { memo, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import { getTagColors, type NoteTagFilter } from './note-tag-utils';

export const NoteTagTabs = memo(function NoteTagTabs({
  tags,
  activeTag,
  onSelect,
  onAddPress,
}: {
  tags: readonly string[];
  activeTag: NoteTagFilter;
  onSelect: (tag: NoteTagFilter) => void;
  onAddPress: () => void;
}) {
  const { colors } = useTheme();
  const pm = useMessages().notesPage;

  const renderTab = useCallback(
    (key: NoteTagFilter, label: string, palette?: { bg: string; fg: string }) => {
      const selected = activeTag === key;
      const bg = palette?.bg ?? (selected ? colors.accent.selectionBg : colors.surface.input);
      const fg = palette?.fg ?? (selected ? colors.accent.primary : colors.text.secondary);
      return (
        <Pressable
          key={key}
          style={[
            styles.tab,
            {
              backgroundColor: bg,
              borderColor: selected ? colors.accent.primary : colors.border.default,
            },
          ]}
          onPress={() => onSelect(key)}
          accessibilityRole="tab"
          accessibilityState={{ selected }}
        >
          <Text style={[styles.tabText, { color: fg }]} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
      );
    },
    [activeTag, colors, onSelect],
  );

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {renderTab('all', pm.tagTabAll)}
        {tags.map((tag) => {
          const palette = getTagColors(tag, tags, colors);
          return renderTab(tag, tag, selectedPalette(activeTag, tag, palette));
        })}
        <Pressable
          style={[styles.addTab, { borderColor: colors.border.default, backgroundColor: colors.surface.input }]}
          onPress={onAddPress}
          accessibilityRole="button"
          accessibilityLabel={pm.tagCreateAction}
        >
          <Icon source="plus" size={16} color={colors.text.secondary} />
        </Pressable>
      </ScrollView>
    </View>
  );
});

function selectedPalette(
  activeTag: NoteTagFilter,
  tag: string,
  palette: { bg: string; fg: string },
): { bg: string; fg: string } | undefined {
  return activeTag === tag ? palette : undefined;
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 8,
  },
  scroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  tab: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: 140,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addTab: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
