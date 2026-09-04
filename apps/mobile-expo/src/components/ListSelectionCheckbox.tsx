import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { motion, useReducedMotion } from '../motion';
import { useTheme } from '../theme';

type ListSelectionCheckboxProps = {
  selected: boolean;
  size?: number;
};

export function ListSelectionCheckbox({ selected, size = 36 }: ListSelectionCheckboxProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const appear = useSharedValue(reducedMotion ? 1 : 0);
  const check = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      appear.value = 1;
      return;
    }
    appear.value = withSpring(1, motion.spring.settle);
  }, [appear, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      check.value = selected ? 1 : 0;
      return;
    }
    check.value = withSpring(selected ? 1 : 0, motion.spring.settle);
  }, [check, reducedMotion, selected]);

  const appearStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    borderColor: interpolateColor(
      check.value,
      [0, 1],
      [colors.border.strong, colors.accent.primary],
    ),
    backgroundColor: interpolateColor(
      check.value,
      [0, 1],
      ['transparent', colors.accent.primary],
    ),
    transform: [{ scale: interpolate(appear.value, [0, 1], [0.9, 1]) }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: interpolate(check.value, [0, 1], [0.78, 1]) }],
  }));

  return (
    <Animated.View
      style={[
        styles.checkbox,
        appearStyle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Animated.View style={checkStyle}>
        <Icon source="check" size={14} color={colors.text.inverse} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  checkbox: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
