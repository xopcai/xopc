import { useMemo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Portal, Snackbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOAST_DURATION_DEFAULT } from '../constants/toast';
import {
  FLOATING_BOTTOM_OFFSET,
  floatingBottomPadding,
  radii,
  spacing,
  typography,
  useTheme,
} from '../theme';

export type AppToastAction = {
  label: string;
  onPress: () => void;
};

export type AppToastProps = {
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
  action?: AppToastAction;
  children: ReactNode;
  /** Extra pixels above the default safe-area bottom inset (e.g. floating composer). */
  bottomLift?: number;
};

export function AppToast({
  visible,
  onDismiss,
  duration = TOAST_DURATION_DEFAULT,
  action,
  children,
  bottomLift = 0,
}: AppToastProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const toastTheme = useMemo(
    () => ({
      colors: {
        inverseSurface: colors.surface.panel,
        inverseOnSurface: colors.text.primary,
        inversePrimary: colors.accent.primary,
      },
    }),
    [colors],
  );

  const wrapperStyle = useMemo(
    () => ({
      bottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + bottomLift,
    }),
    [bottomLift, insets.bottom],
  );

  const snackStyle = useMemo(
    () => ({
      marginHorizontal: spacing.lg,
      borderRadius: radii.xxl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border.default,
      shadowColor: '#000',
      shadowOpacity: isDark ? 0.18 : 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    }),
    [colors.border.default, isDark],
  );

  const contentStyle = useMemo(
    () => ({
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md + 2,
    }),
    [],
  );

  return (
    <Portal>
      <Snackbar
        visible={visible}
        onDismiss={onDismiss}
        duration={duration}
        action={action}
        theme={toastTheme}
        wrapperStyle={wrapperStyle}
        style={snackStyle}
        contentStyle={contentStyle}
        elevation={3}
      >
        {children}
      </Snackbar>
    </Portal>
  );
}

/** Typography for custom toast content (icons, animated rows). */
export function useToastContentStyle() {
  const { colors } = useTheme();
  return useMemo(
    () => [typography.ui, { color: colors.text.primary, flex: 1 }],
    [colors.text.primary],
  );
}
