import { useEffect, type ReactNode } from 'react';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion, useReducedMotion } from '../../motion';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';

/** Safe-area space belongs to the tab dock when browsing, and the accessory when open. */
export function ChatComposerDock({ root, panelOpen, bottomInset, children }: {
  root: boolean;
  panelOpen: boolean;
  bottomInset: number;
  children: ReactNode;
}) {
  const keyboard = useReanimatedKeyboardAnimation();
  const reducedMotion = useReducedMotion();
  const panel = useSharedValue(panelOpen ? 1 : 0);
  useEffect(() => {
    panel.value = withTiming(panelOpen ? 1 : 0, {
      duration: reducedMotion ? 0 : motion.duration.standard,
      easing: panelOpen ? motion.easing.enter : motion.easing.exit,
    });
  }, [panel, panelOpen, reducedMotion]);
  const restingInset = root ? bottomInset : floatingBottomPadding(bottomInset);
  const style = useAnimatedStyle(() => ({
    paddingBottom: restingInset * (root ? panel.value : 1)
      * (1 - Math.min(1, Math.max(0, keyboard.progress.value))),
  }));
  return <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ backgroundColor: 'transparent', marginBottom: FLOATING_BOTTOM_OFFSET }}>
    <Animated.View style={style}>{children}</Animated.View>
  </KeyboardStickyView>;
}
