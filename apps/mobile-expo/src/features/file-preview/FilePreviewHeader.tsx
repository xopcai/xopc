import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { spacing, typography, useTheme } from '../../theme';

export type FilePreviewHeaderAction = {
  key: string;
  label: string;
  icon: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
};

export type FilePreviewHeaderProps = {
  title: string;
  onClose: () => void;
  closeLabel: string;
  shareLabel: string;
  moreActionsLabel: string;
  share?: Omit<FilePreviewHeaderAction, 'key' | 'label' | 'icon'>;
  moreActions: FilePreviewHeaderAction[];
};

/** The single header used by every full-screen file preview on mobile. */
export function FilePreviewHeader({
  title,
  onClose,
  closeLabel,
  shareLabel,
  moreActionsLabel,
  share,
  moreActions,
}: FilePreviewHeaderProps) {
  const { colors } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);

  const runAction = (action: FilePreviewHeaderAction) => {
    if (action.disabled || action.loading) return;
    setMenuVisible(false);
    void action.onPress();
  };

  return (
    <>
      <View style={[styles.header, { borderBottomColor: colors.border.default }]}>
        <Text variant="titleMedium" numberOfLines={1} style={[styles.title, { color: colors.text.primary }]}>
          {title}
        </Text>
        <IconButton
          icon={share?.loading ? 'loading' : 'share-variant-outline'}
          size={21}
          iconColor={share ? colors.text.primary : colors.text.disabled}
          onPress={() => share && void share.onPress()}
          accessibilityLabel={shareLabel}
          disabled={!share || share.disabled || share.loading}
        />
        <IconButton
          icon="dots-horizontal"
          size={22}
          iconColor={colors.text.primary}
          onPress={() => setMenuVisible(true)}
          accessibilityLabel={moreActionsLabel}
          disabled={moreActions.length === 0}
        />
        <IconButton
          icon="close"
          size={22}
          iconColor={colors.text.primary}
          onPress={onClose}
          accessibilityLabel={closeLabel}
        />
      </View>
      <BottomSheetModal visible={menuVisible} onDismiss={() => setMenuVisible(false)} title={title} maxHeight="48%">
        <View style={styles.actionList}>
          {moreActions.map((action) => {
            const disabled = Boolean(action.disabled || action.loading);
            return (
              <Pressable
                key={action.key}
                style={({ pressed }) => [
                  styles.action,
                  pressed && !disabled && { backgroundColor: colors.surface.pressed },
                ]}
                onPress={() => runAction(action)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled }}
              >
                <Icon source={action.loading ? 'loading' : action.icon} size={22} color={disabled ? colors.text.disabled : colors.text.secondary} />
                <Text style={[styles.actionLabel, { color: disabled ? colors.text.disabled : colors.text.primary }]}>
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing.lg,
  },
  title: {
    flex: 1,
    minWidth: 0,
    ...typography.ui,
    fontWeight: '600',
  },
  actionList: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  action: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    ...typography.ui,
    fontWeight: '500',
  },
});
