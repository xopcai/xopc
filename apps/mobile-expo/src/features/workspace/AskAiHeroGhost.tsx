import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { useMessages } from '../../i18n/messages';
import { motion } from '../../motion';
import { useTheme } from '../../theme';

import { useWorkspaceTransition } from './workspace-transition-context';

const AnimatedView = Animated.createAnimatedComponent(View);

export const AskAiHeroGhost = memo(function AskAiHeroGhost() {
  const { colors, isDark } = useTheme();
  const hm = useMessages().homePage;
  const { phase, progress, pillAnchor, composerAnchor } = useWorkspaceTransition();
  const controlBg = isDark ? colors.surface.input : colors.surface.panel;

  const ghostStyle = useAnimatedStyle(() => {
    if (!pillAnchor || !composerAnchor) {
      return { opacity: 0 };
    }

    const t = progress.value;
    const left = interpolate(t, [0, 1], [pillAnchor.x, composerAnchor.x], Extrapolation.CLAMP);
    const top = interpolate(t, [0, 1], [pillAnchor.y, composerAnchor.y], Extrapolation.CLAMP);
    const width = interpolate(t, [0, 1], [pillAnchor.width, composerAnchor.width], Extrapolation.CLAMP);
    const height = interpolate(t, [0, 1], [pillAnchor.height, composerAnchor.height], Extrapolation.CLAMP);
    const borderRadius = interpolate(
      t,
      [0, 1],
      [motion.hero.borderRadiusFrom, motion.hero.borderRadiusTo],
      Extrapolation.CLAMP,
    );
    const shellOpacity = interpolate(
      t,
      [0, 0.06, motion.hero.revealComposerAt, 1],
      [0, 1, 0.35, 0],
      Extrapolation.CLAMP,
    );

    return {
      opacity: shellOpacity,
      left,
      top,
      width,
      height,
      borderRadius,
      transform: [{ scale: interpolate(t, [0, 1], [1, 1.02], Extrapolation.CLAMP) }],
    };
  }, [composerAnchor, pillAnchor]);

  const labelStyle = useAnimatedStyle(() => {
    if (!pillAnchor || !composerAnchor) return { opacity: 0 };
    const labelOpacity = interpolate(
      progress.value,
      [0, 0.35, 0.7],
      [1, 0.35, 0],
      Extrapolation.CLAMP,
    );
    return { opacity: labelOpacity };
  });

  if (phase === 'closed') return null;

  return (
    <AnimatedView
      pointerEvents="none"
      style={[
        styles.ghost,
        { backgroundColor: controlBg, borderColor: colors.border.default },
        ghostStyle,
      ]}
    >
      <Icon source="creation-outline" size={18} color={colors.accent.primary} />
      <Animated.View style={labelStyle}>
        <Text style={[styles.label, { color: colors.text.tertiary }]} numberOfLines={1}>
          {hm.askAi}
        </Text>
      </Animated.View>
    </AnimatedView>
  );
});

const styles = StyleSheet.create({
  ghost: {
    position: 'absolute',
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
  },
});
