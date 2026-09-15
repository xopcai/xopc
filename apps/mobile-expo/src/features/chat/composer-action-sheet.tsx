import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { radii, spacing, typography, useTheme } from '../../theme';

export type ComposerSheetAction = {
  key: string;
  onPress: () => void;
  disabled?: boolean;
  icon: string;
  label: string;
  description?: string;
};

export const ComposerActionSheet = memo(function ComposerActionSheet({
  visible,
  items,
  onClose,
}: {
  visible: boolean;
  items: ComposerSheetAction[];
  onClose: () => void;
}) {
  const { colors } = useTheme();

  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} maxHeight="60%" scroll disableAnimation>
      <View style={styles.grid}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [styles.cell, { opacity: item.disabled ? 0.45 : pressed ? 0.75 : 1 }]}
            onPress={() => {
              onClose();
              item.onPress();
            }}
            disabled={item.disabled}
            accessibilityState={{ disabled: !!item.disabled }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityHint={item.description}
          >
            <View style={[styles.iconTile, { backgroundColor: colors.surface.input }]}>
              <Icon source={item.icon} size={26} color={colors.text.primary} />
            </View>
            <Text style={[styles.label, { color: colors.text.secondary }]}>{item.label}</Text>
            {item.description && <Text style={[styles.description, { color: colors.text.tertiary }]}>{item.description}</Text>}
          </Pressable>
        ))}
      </View>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: spacing.xl,
    paddingHorizontal: spacing.content,
    paddingTop: spacing.sm,
  },
  cell: {
    alignItems: 'center',
    width: '33.333%',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    ...typography.caption,
    textAlign: 'center',
  },
  label: {
    ...typography.caption,
    fontWeight: '500',
    textAlign: 'center',
  },
});
