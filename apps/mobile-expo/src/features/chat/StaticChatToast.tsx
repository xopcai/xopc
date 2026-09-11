import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOAST_DURATION_DEFAULT } from '../../constants/toast';
import {
  FLOATING_BOTTOM_OFFSET,
  floatingBottomPadding,
  radii,
  spacing,
  typography,
  useTheme,
} from '../../theme';

/** Chat toast that appears and disappears without Snackbar motion. */
export function StaticChatToast({
  visible,
  onDismiss,
  duration = TOAST_DURATION_DEFAULT,
  bottomLift = 0,
  action,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
  bottomLift?: number;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!visible || duration <= 0) return undefined;
    const timer = setTimeout(() => onDismissRef.current(), duration);
    return () => clearTimeout(timer);
  }, [duration, visible]);

  if (!visible) return null;

  return (
    <Portal>
      <View
        pointerEvents="box-none"
        style={[
          styles.wrapper,
          { bottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + bottomLift },
        ]}
      >
        <View
          accessibilityRole="alert"
          style={[
            styles.toast,
            {
              backgroundColor: colors.surface.panel,
              borderColor: colors.border.default,
            },
            elevation.raised,
          ]}
        >
          <Text style={[styles.copy, { color: colors.text.primary }]}>{children}</Text>
          {action ? (
            <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
              <Text style={[styles.actionText, { color: colors.accent.primary }]}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
  toast: {
    minHeight: 48,
    borderRadius: radii.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  copy: {
    ...typography.ui,
    flex: 1,
  },
  action: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionText: {
    ...typography.label,
    fontWeight: '600',
  },
});
