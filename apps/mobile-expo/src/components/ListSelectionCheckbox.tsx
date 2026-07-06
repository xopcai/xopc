import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';

import { useReducedMotion } from '../motion';
import { useTheme } from '../theme';

type ListSelectionCheckboxProps = {
  selected: boolean;
  size?: number;
};

export function ListSelectionCheckbox({ selected, size = 36 }: ListSelectionCheckboxProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const appear = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const check = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      appear.setValue(1);
      return;
    }
    Animated.spring(appear, {
      toValue: 1,
      damping: 18,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [appear, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      check.setValue(selected ? 1 : 0);
      return;
    }
    Animated.spring(check, {
      toValue: selected ? 1 : 0,
      damping: 16,
      stiffness: 300,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  }, [check, reducedMotion, selected]);

  const appearStyle = {
    opacity: appear,
    transform: [
      {
        scale: appear.interpolate({
          inputRange: [0, 1],
          outputRange: [0.86, 1],
        }),
      },
    ],
  };

  const checkStyle = {
    opacity: check,
    transform: [
      {
        scale: check.interpolate({
          inputRange: [0, 1],
          outputRange: [0.7, 1],
        }),
      },
    ],
  };

  return (
    <Animated.View
      style={[
        styles.checkbox,
        appearStyle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: selected ? colors.accent.primary : colors.border.strong,
          backgroundColor: selected ? colors.accent.primary : 'transparent',
        },
      ]}
    >
      <Animated.View style={checkStyle}>
        {selected ? <Icon source="check" size={14} color={colors.text.inverse} /> : null}
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
