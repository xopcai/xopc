import { BottomTabBar, type BottomTabBarProps, type BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { KeyboardController, useKeyboardHandler, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useChatChromeStore } from './chat-chrome-store';

import { motion, useReducedMotion } from '../../motion';
import { radii, spacing, useTheme } from '../../theme';

export const TAB_DOCK_HEIGHT = spacing.xxxl + spacing.xs;
export const TAB_DOCK_INSET = spacing.xs;

function DockBackground() {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[styles.background, { backgroundColor: colors.surface.elevated, borderColor: colors.border.subtle }]}
    />
  );
}

/** One layout owner for keyboard and accessory-panel transitions. */
export function CapsuleTabBar({ embedded = false, ...props }: BottomTabBarProps & { embedded?: boolean }) {
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const panelOpen = useChatChromeStore(state => state.actionPanelOpen);
  const panelVisible = props.state.routes[props.state.index].name === '(chat)' && panelOpen;
  const reducedMotion = useReducedMotion();
  const panelProgress = useSharedValue(panelVisible ? 1 : 0);
  const handoff = useSharedValue(0);
  const [keyboardVisible, setKeyboardVisible] = useState(() => KeyboardController.state().height > 0);
  const dockHeight = TAB_DOCK_HEIGHT + Math.max(insets.bottom, spacing.sm);
  useKeyboardHandler({
    onStart: event => {
      'worklet';
      if (event.height > 0) {
        if (panelProgress.value > 0) handoff.value = 1;
        scheduleOnRN(setKeyboardVisible, true);
      }
    },
    onEnd: event => {
      'worklet';
      if (event.height > 0 || !panelVisible) handoff.value = 0;
      scheduleOnRN(setKeyboardVisible, event.height > 0);
    },
  }, [panelVisible]);
  useEffect(() => {
    if (panelVisible && keyboard.progress.value > 0) handoff.value = 1;
    panelProgress.value = withTiming(panelVisible ? 1 : 0, {
      duration: reducedMotion ? 0 : motion.duration.standard,
      easing: panelVisible ? motion.easing.enter : motion.easing.exit,
    }, finished => {
      if (finished && panelVisible) handoff.value = 0;
    });
  }, [handoff, keyboard.progress, panelProgress, panelVisible, reducedMotion]);
  const dockStyle = useAnimatedStyle(() => {
    const hidden = Math.min(1, Math.max(0, keyboard.progress.value, panelProgress.value, handoff.value));
    return { height: dockHeight * (1 - hidden), opacity: 1 - hidden };
  });
  const hidden = panelVisible || keyboardVisible;
  const descriptors = Object.fromEntries(Object.entries(props.descriptors).map(([key, descriptor]) => [key, {
    ...descriptor,
    options: {
      ...descriptor.options,
      tabBarBackground: embedded ? undefined : () => <DockBackground />,
      ...(embedded ? { tabBarStyle: [descriptor.options.tabBarStyle, {
        marginHorizontal: 0,
        marginBottom: 0,
        borderRadius: 0,
        borderTopWidth: 0,
        height: dockHeight,
        paddingBottom: TAB_DOCK_INSET + Math.max(insets.bottom, spacing.sm),
      }] } : {}),
    },
  }]));
  return <Animated.View style={[styles.dockClip, dockStyle]} pointerEvents={hidden ? 'none' : 'auto'}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    <View style={{ height: dockHeight }}>
      <BottomTabBar {...props} descriptors={descriptors} />
    </View>
  </Animated.View>;
}

export function CapsuleTabButton({ children, onPress, onLongPress, accessibilityLabel, accessibilityState, testID, style, onLayout, disabled }: BottomTabBarButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayout}
      disabled={disabled}
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
      style={({ pressed }) => [style, styles.button, { opacity: pressed ? 0.7 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

export function CapsuleTabIcon({ source, focused }: { source: string; focused: boolean }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(focused ? 1.06 : 1);
  useEffect(() => {
    scale.value = reducedMotion ? 1 : withSpring(focused ? 1.06 : 1, motion.spring.settle);
  }, [focused, reducedMotion, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[
      styles.iconSelection,
      { backgroundColor: focused ? colors.surface.grouped : 'transparent' },
      style,
    ]}>
      <Icon source={source} size={22} color={focused ? colors.accent.primary : colors.text.secondary} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dockClip: { overflow: 'hidden' },
  background: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  iconSelection: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  button: { minHeight: 44, borderRadius: radii.full, backgroundColor: 'transparent' },
});
