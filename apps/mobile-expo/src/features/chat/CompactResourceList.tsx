import { FlashList } from '@shopify/flash-list';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { spacing, useTheme } from '../../theme';
import { compactResourcePreview } from './compact-resource-list';

const RESOURCE_ROW_HEIGHT = 52;

export function CompactResourceList<T>({
  items,
  title,
  moreLabel,
  keyExtractor,
  renderItem,
  embedded = false,
}: {
  items: T[];
  title: string;
  moreLabel: (count: number) => string;
  keyExtractor: (item: T, index: number) => string;
  renderItem: (
    item: T,
    index: number,
    requestAction: (action: () => void) => void,
  ) => React.ReactElement;
  embedded?: boolean;
}) {
  const { colors } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const { visible, hiddenCount } = compactResourcePreview(items);
  const listHeight = Math.min(items.length * RESOURCE_ROW_HEIGHT, screenHeight * 0.6);

  if (!items.length) return null;

  return (
    <>
      <View style={styles.preview} accessibilityLabel={title}>
        {visible.map((item, index) => (
          <View key={keyExtractor(item, index)}>
            {renderItem(item, index, (action) => action())}
          </View>
        ))}
        {hiddenCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={moreLabel(hiddenCount)}
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(true)}
            style={({ pressed }) => [
              styles.moreRow,
              {
                backgroundColor: pressed
                  ? colors.surface.pressed
                  : embedded ? 'transparent' : colors.surface.input,
              },
            ]}
          >
            <Text style={[styles.moreText, { color: colors.accent.primary }]} numberOfLines={1}>
              {moreLabel(hiddenCount)}
            </Text>
            <Icon source="chevron-up" size={18} color={colors.accent.primary} />
          </Pressable>
        ) : null}
      </View>

      <BottomSheetModal
        visible={open}
        onDismiss={() => setOpen(false)}
        onAfterDismiss={() => {
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          action?.();
        }}
        title={title}
        maxHeight="80%"
      >
        <View style={[styles.sheetList, { height: listHeight }]}>
          <FlashList
            data={items}
            keyExtractor={keyExtractor}
            renderItem={({ item, index }) => renderItem(item, index, (action) => {
              pendingActionRef.current = action;
              setOpen(false);
            })}
            ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </BottomSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  preview: {
    gap: spacing.xs,
  },
  moreRow: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  moreText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
  },
  sheetList: {
    minHeight: RESOURCE_ROW_HEIGHT,
  },
  sheetContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
