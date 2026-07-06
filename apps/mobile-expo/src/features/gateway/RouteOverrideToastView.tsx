/**
 * Toast that renders a leading icon driven by the override-toast state
 * machine. Pending shows a spinner; ok/error fade-swaps the icon while the
 * toast stays mounted so the user sees the morph in place.
 */
import { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { TOAST_BOTTOM_LIFT_ABOVE_BAR } from '../../constants/toast';
import { AppToast, useToastContentStyle } from '../../components/AppToast';
import { useTheme } from '../../theme';

import type { RouteOverrideToast } from './use-route-override-toast';

export type RouteOverrideToastViewProps = {
  toast: RouteOverrideToast;
  onDismiss: () => void;
  bottomLift?: number;
};

export const RouteOverrideToastView = memo(function RouteOverrideToastView({
  toast,
  onDismiss,
  bottomLift = TOAST_BOTTOM_LIFT_ABOVE_BAR,
}: RouteOverrideToastViewProps) {
  const { colors } = useTheme();
  const messageStyle = useToastContentStyle();

  if (!toast) {
    return (
      <AppToast visible={false} onDismiss={onDismiss} duration={120_000} bottomLift={bottomLift}>
        {''}
      </AppToast>
    );
  }

  const tint =
    toast.status === 'error'
      ? colors.semantic.errorBold
      : toast.status === 'ok'
        ? colors.semantic.success
        : colors.semantic.info;

  return (
    <AppToast
      key={toast.key}
      visible
      onDismiss={onDismiss}
      duration={120_000}
      bottomLift={bottomLift}
    >
      <View style={styles.row}>
        <Animated.View
          key={`icon-${toast.status}-${toast.icon}`}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.iconWrap}
        >
          {toast.icon === 'spinner' ? (
            <ActivityIndicator size={14} color={tint} />
          ) : (
            <Icon source={iconSource(toast.icon)} size={16} color={tint} />
          )}
        </Animated.View>
        <Animated.Text
          key={`msg-${toast.message}`}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={messageStyle}
          numberOfLines={2}
        >
          {toast.message}
        </Animated.Text>
      </View>
    </AppToast>
  );
});

function iconSource(icon: NonNullable<RouteOverrideToast>['icon']): string {
  switch (icon) {
    case 'check':
      return 'check-circle-outline';
    case 'error':
      return 'alert-circle-outline';
    case 'lan':
      return 'lan-connect';
    case 'cloud':
      return 'cloud-check-outline';
    default:
      return 'progress-clock';
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
