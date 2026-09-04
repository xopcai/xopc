import { useEffect } from 'react';
import { Icon } from 'react-native-paper';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion, useReducedMotion } from '../motion';

export function AnimatedDisclosureIcon({
  expanded,
  color,
  size = 16,
}: {
  expanded: boolean;
  color: string;
  size?: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = reducedMotion
      ? (expanded ? 1 : 0)
      : withTiming(expanded ? 1 : 0, {
          duration: motion.duration.quick,
          easing: motion.easing.enter,
        });
  }, [expanded, progress, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle} accessible={false}>
      <Icon source="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}
