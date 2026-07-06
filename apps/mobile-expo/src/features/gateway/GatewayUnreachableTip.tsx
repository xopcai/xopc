import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useTheme } from '../../theme';

type GatewayUnreachableTipProps = {
  message: string;
  onPress: () => void;
};

export const GatewayUnreachableTip = memo(function GatewayUnreachableTip({
  message,
  onPress,
}: GatewayUnreachableTipProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        styles.wrap,
        {
          backgroundColor: colors.surface.input,
          borderColor: colors.semantic.errorBold,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Icon source="wifi-off" size={16} color={colors.semantic.errorBold} />
      <Text style={[styles.message, { color: colors.semantic.errorBold }]} numberOfLines={3}>
        {message}
      </Text>
      <Icon source="chevron-right" size={18} color={colors.semantic.errorBold} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
