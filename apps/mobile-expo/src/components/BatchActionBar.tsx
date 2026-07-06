import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Animated } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '../motion';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, useTheme } from '../theme';

export type BatchActionBarItem = {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

interface BatchActionBarProps {
  items: BatchActionBarItem[];
}

export function BatchActionBar({ items }: BatchActionBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const barBg = colors.surface.panel;
  const defaultIcon = colors.text.secondary;
  const defaultLabel = colors.text.tertiary;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    Animated.spring(progress, {
      toValue: 1,
      damping: 22,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [progress, reducedMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [16, 0],
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.98, 1],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[styles.wrap, animatedStyle, { paddingBottom: floatingBottomPadding(insets.bottom) }]}>
      <View style={[styles.bar, { backgroundColor: barBg, shadowColor: '#000' }]}>
        {items.map((item) => {
          const iconColor = item.destructive ? colors.semantic.error : defaultIcon;
          const labelColor = item.destructive ? colors.semantic.error : defaultLabel;
          return (
            <Pressable
              key={item.key}
              style={({ pressed }) => [
                styles.action,
                (item.disabled || item.loading) && styles.disabled,
                pressed && styles.actionPressed,
              ]}
              onPress={item.onPress}
              disabled={item.disabled || item.loading}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Icon source={item.loading ? 'loading' : item.icon} size={18} color={iconColor} />
              <Text numberOfLines={1} style={[styles.label, { color: labelColor }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: FLOATING_BOTTOM_OFFSET,
    alignItems: 'center',
    paddingTop: 6,
    zIndex: 20,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingVertical: 7,
    paddingHorizontal: 8,
    maxWidth: '96%',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 2,
    minWidth: 64,
    flexShrink: 1,
  },
  actionPressed: {
    opacity: 0.55,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 13,
  },
});
