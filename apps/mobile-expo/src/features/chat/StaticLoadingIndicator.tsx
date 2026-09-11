import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from 'react-native-paper';

import { useTheme } from '../../theme';

/** Static progress marker for chat surfaces; deliberately has no rotation or fade. */
export const StaticLoadingIndicator = memo(function StaticLoadingIndicator({
  size = 16,
  color,
  style,
  accessibilityLabel,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <Icon source="clock-outline" size={size} color={color ?? colors.text.secondary} />
    </View>
  );
});
