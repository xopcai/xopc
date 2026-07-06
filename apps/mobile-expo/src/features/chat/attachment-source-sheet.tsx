import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useTheme } from '../../theme';
import type { AttachmentPickSource } from './attachment-file-io';

type SheetItem = {
  source: AttachmentPickSource;
  icon: string;
  label: string;
};

export const AttachmentSourceSheet = memo(function AttachmentSourceSheet({
  visible,
  items,
  onPick,
  onClose,
}: {
  visible: boolean;
  items: SheetItem[];
  onPick: (source: AttachmentPickSource) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} maxHeight="42%">
      <View style={styles.grid}>
        {items.map((item) => (
          <Pressable
            key={item.source}
            style={({ pressed }) => [styles.cell, pressed && { opacity: 0.75 }]}
            onPress={() => {
              onClose();
              onPick(item.source);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <View style={[styles.iconTile, { backgroundColor: colors.surface.input }]}>
              <Icon source={item.icon} size={26} color={colors.text.primary} />
            </View>
            <Text style={[styles.label, { color: colors.text.secondary }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 24,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  cell: {
    alignItems: 'center',
    width: 72,
    gap: 8,
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});
