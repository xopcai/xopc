import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

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
  const visible = state.kind === 'token-invalid' || state.kind === 'unconfigured';

  const onPress = useCallback(() => {
    if (state.kind === 'token-invalid') onReconnect?.();
    else if (state.kind === 'unconfigured') onOpenSettings?.();
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
          borderBottomColor: colors.semantic.errorBold,
        },
      ]}
    >
      <Icon
        source={state.kind === 'token-invalid' ? 'lock-alert' : 'link-variant-off'}
        size={16}
        color={colors.semantic.errorBold}
      />
      <View style={styles.copy}>
        <Text style={[styles.message, { color: colors.semantic.errorBold }]} numberOfLines={2}>
          {copy.long}
        </Text>
      </View>
      <Text style={[styles.action, { color: colors.semantic.errorBold }]}>{copy.actionLabel}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  banner: {
    minHeight: 42,
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
