import { memo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { radii, spacing, typography, useTheme } from '../../theme';

export type ComposerSheetAction = {
  key: string;
  group?: string;
  onPress: () => void;
  disabled?: boolean;
  icon: string;
  label: string;
  description?: string;
};

export const ComposerActionSheet = memo(function ComposerActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title?: string;
  items: ComposerSheetAction[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const pendingAction = useRef<(() => void) | null>(null);
  const groups = [...new Set(items.map(item => item.group))];

  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} title={title} maxHeight="75%" scroll
      onAfterDismiss={() => {
        const action = pendingAction.current;
        pendingAction.current = null;
        action?.();
      }}
    >
      {groups.map((group, index) => (
        <View key={group ?? 'actions'} style={index > 0 ? [styles.section, { borderTopColor: colors.border.subtle }] : undefined}>
          <View style={styles.grid}>
            {items.filter(item => item.group === group).map((item) => (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.cell, { backgroundColor: pressed ? colors.surface.hover : colors.surface.panel, opacity: item.disabled ? 0.45 : 1 }]}
                onPress={() => {
                  if (pendingAction.current) return;
                  pendingAction.current = item.onPress;
                  onClose();
                }}
                disabled={item.disabled}
                accessibilityState={{ disabled: !!item.disabled }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityHint={item.description}
              >
                <View style={[styles.iconTile, { backgroundColor: colors.surface.input }]}>
                  <Icon source={item.icon} size={spacing.xl} color={colors.text.primary} />
                </View>
                <Text style={[styles.label, { color: colors.text.secondary }]}>{item.label}</Text>
                {item.description && <Text style={[styles.description, { color: colors.text.tertiary }]}>{item.description}</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  cell: {
    alignItems: 'center',
    width: '33.333%',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
  },
  iconTile: {
    width: spacing.xxxl + spacing.sm,
    height: spacing.xxxl + spacing.sm,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    ...typography.caption,
    textAlign: 'center',
  },
  label: {
    ...typography.label,
    fontWeight: '500',
    textAlign: 'center',
  },
});
