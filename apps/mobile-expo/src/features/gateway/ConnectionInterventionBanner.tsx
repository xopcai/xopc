import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

import { requestMobileRealtimeReconnect } from './use-gateway-realtime';
import { copyForConnectionState, useConnectionState } from './connection-state';

export type ConnectionInterventionBannerProps = {
  onOpenSettings?: () => void;
  onReconnect?: () => void;
};

/** Only renders connection states that require a user decision. */
export const ConnectionInterventionBanner = memo(function ConnectionInterventionBanner({
  onOpenSettings,
  onReconnect,
}: ConnectionInterventionBannerProps) {
  const m = useMessages();
  const { colors } = useTheme();
  const state = useConnectionState();
  const visible = state.kind !== 'ok-direct';
  const color = state.kind === 'token-invalid' ? colors.semantic.errorBold : colors.text.secondary;

  const onPress = useCallback(() => {
    if (state.kind === 'token-invalid') onReconnect?.();
    else if (state.kind === 'unconfigured') onOpenSettings?.();
    else requestMobileRealtimeReconnect();
  }, [onOpenSettings, onReconnect, state.kind]);

  if (!visible) return null;

  const copy = copyForConnectionState(state, m.gateway.state);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.banner,
        {
          backgroundColor: colors.surface.input,
          borderBottomColor: color,
        },
      ]}
    >
      <Icon
        source={state.kind === 'token-invalid' ? 'lock-alert' : 'link-variant-off'}
        size={16}
        color={color}
      />
      <View style={styles.copy}>
        <Text style={[styles.message, { color }]} numberOfLines={2}>
          {copy.long}
        </Text>
      </View>
      <Text style={[styles.action, { color }]}>{copy.actionLabel}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  banner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1 },
  message: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  action: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
