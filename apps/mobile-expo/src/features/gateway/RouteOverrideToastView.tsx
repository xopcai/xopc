import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { AppToast, useToastContentStyle } from '../../components/AppToast';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR } from '../../constants/toast';
import { useTheme } from '../../theme';

import type { RouteOverrideToast } from './use-route-override-toast';

export const RouteOverrideToastView = memo(function RouteOverrideToastView({
  toast,
  onDismiss,
  bottomLift = TOAST_BOTTOM_LIFT_ABOVE_BAR,
}: {
  toast: RouteOverrideToast;
  onDismiss: () => void;
  bottomLift?: number;
}) {
  const { colors } = useTheme();
  const messageStyle = useToastContentStyle();
  return (
    <AppToast
      key={toast?.key ?? 'none'}
      visible={Boolean(toast)}
      onDismiss={onDismiss}
      duration={120_000}
      bottomLift={bottomLift}
    >
      <View style={styles.row}>
        <Icon source={iconSource(toast?.icon)} size={16} color={colors.semantic.success} />
        <View style={styles.message}>
          {toast ? <Text style={messageStyle} numberOfLines={2}>{toast.message}</Text> : null}
        </View>
      </View>
    </AppToast>
  );
});

function iconSource(icon?: NonNullable<RouteOverrideToast>['icon']): string {
  if (icon === 'lan') return 'lan-connect';
  if (icon === 'cloud') return 'cloud-check-outline';
  return 'check-circle-outline';
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  message: { flex: 1 },
});
