import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

type GatewayOfflineBannerProps = {
  visible: boolean;
};

export const GatewayOfflineBanner = memo(function GatewayOfflineBanner({
  visible,
}: GatewayOfflineBannerProps) {
  const m = useMessages();
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface.input,
          borderBottomColor: colors.border.default,
        },
      ]}
    >
      <Icon source="cloud-off-outline" size={16} color={colors.semantic.warning} />
      <Text style={[styles.message, { color: colors.semantic.warning }]} numberOfLines={2}>
        {m.gateway.offlineBanner}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
