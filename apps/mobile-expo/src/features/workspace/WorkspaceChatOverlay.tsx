import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { motion } from '../../motion';
import { useTheme } from '../../theme';

import { ChatScreen } from '../chat/ChatScreen';

import { useWorkspaceTransition } from './workspace-transition-context';

const AnimatedView = Animated.createAnimatedComponent(View);

type WorkspaceChatOverlayProps = {
  onRequestHome: () => void;
};

export const WorkspaceChatOverlay = memo(function WorkspaceChatOverlay({
  onRequestHome,
}: WorkspaceChatOverlayProps) {
  const { isDark } = useTheme();
  const { isChatWarm, progress, dismissDrag, phase } = useWorkspaceTransition();

  const overlayStyle = useAnimatedStyle(() => {
    const openAmount = progress.value * (1 - dismissDrag.value / motion.dismiss.maxDragFraction);
    const translateY = interpolate(openAmount, [0, 1], [28, 0], Extrapolation.CLAMP);
    return {
      opacity: openAmount,
      transform: [{ translateY }],
    };
  });

  const scrimStyle = useAnimatedStyle(() => {
    const openAmount = progress.value * (1 - dismissDrag.value / motion.dismiss.maxDragFraction);
    return {
      opacity: interpolate(openAmount, [0, 1], [0, 0.22], Extrapolation.CLAMP),
    };
  });

  if (!isChatWarm) return null;

  const interactive = phase === 'opening' || phase === 'open' || phase === 'closing';

  return (
    <>
      <AnimatedView pointerEvents="none" style={[styles.scrim, scrimStyle]}>
        <BlurView intensity={isDark ? 28 : 18} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      </AnimatedView>
      <AnimatedView
        style={[styles.overlay, overlayStyle]}
        pointerEvents={interactive ? 'auto' : 'none'}
      >
        <ChatScreen overlay onRequestHome={onRequestHome} />
      </AnimatedView>
    </>
  );
});

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
});
