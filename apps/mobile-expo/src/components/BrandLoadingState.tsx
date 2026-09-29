import { memo, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { spacing, typography, useTheme } from '../theme';
import { XopcLogo } from './XopcLogo';

export type BrandLoadingStateProps = {
  label: string;
  compact?: boolean;
};

/** A calm branded transition state for destination pages while their first payload loads. */
export const BrandLoadingState = memo(function BrandLoadingState({
  label,
  compact = false,
}: BrandLoadingStateProps) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 720, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 720, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const animatedStyle = reduceMotion ? undefined : {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) }],
  };

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.container, compact && styles.compact]}
    >
      <Animated.View style={animatedStyle}><XopcLogo size={compact ? 24 : 44} /></Animated.View>
      {!compact ? <Text style={[styles.label, { color: colors.text.tertiary }]}>{label}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    minHeight: 220,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  compact: {
    minHeight: 44,
    flex: 0,
  },
  label: {
    ...typography.label,
  },
});
