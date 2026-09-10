import { Image, StyleSheet } from 'react-native';

import { useTheme } from '../theme';
import darkLogoMarkSource from '../../assets/splash-icon-dark.png';
import lightLogoMarkSource from '../../assets/splash-icon.png';

interface XopcLogoProps {
  size?: number;
}

export function XopcLogo({ size = 32 }: XopcLogoProps) {
  const { isDark } = useTheme();

  return (
    <Image
      source={isDark ? darkLogoMarkSource : lightLogoMarkSource}
      style={[styles.logo, { width: size, height: size }]}
      resizeMode="contain"
      accessible
      accessibilityLabel="xopc"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    flexShrink: 0,
  },
});
