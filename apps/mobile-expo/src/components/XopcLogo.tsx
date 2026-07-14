import { Image, StyleSheet } from 'react-native';

import { useTheme } from '../theme';
import logoMarkSource from '../../assets/splash-icon.png';


interface XopcLogoProps {
  size?: number;
}

export function XopcLogo({ size = 32 }: XopcLogoProps) {
  const { colors } = useTheme();

  return (
    <Image
      source={logoMarkSource}
      style={[styles.logo, { width: size, height: size, tintColor: colors.text.primary }]}
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
