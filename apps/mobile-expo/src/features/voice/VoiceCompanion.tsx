import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { XopcLogo } from '../../components/XopcLogo';
import { useReducedMotion } from '../../motion';
import { useTheme } from '../../theme';

export type VoiceCompanionMood = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'waiting' | 'offline';

type RippleProps = {
  color: string;
  offset: number;
  progress: SharedValue<number>;
  size: number;
  strength: number;
};

function WaterRipple({ color, offset, progress, size, strength }: RippleProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const phase = (progress.value + offset) % 1;
    return {
      opacity: interpolate(phase, [0, 0.18, 1], [0, strength, 0]),
      transform: [{ scale: interpolate(phase, [0, 1], [0.82, 1.22]) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        animatedStyle,
      ]}
    />
  );
}

export function VoiceBrandMark({ size }: { size: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.brandMark,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface.elevated },
      ]}
    >
      <XopcLogo size={size} />
    </View>
  );
}

export function VoiceCompanion({ mood, size = 190 }: { mood: VoiceCompanionMood; size?: number }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const flow = useSharedValue(0);
  const breathe = useSharedValue(0);
  const blink = useSharedValue(0);
  const mouth = useSharedValue(0);
  const active = mood !== 'offline' && mood !== 'waiting';
  const speaking = mood === 'speaking';

  useEffect(() => {
    cancelAnimation(flow);
    cancelAnimation(breathe);
    flow.value = 0;
    breathe.value = 0;
    if (reducedMotion || !active) return;

    const flowDuration = speaking ? 1300 : mood === 'thinking' ? 1750 : 2300;
    flow.value = withRepeat(withTiming(1, { duration: flowDuration, easing: Easing.linear }), -1, false);
    breathe.value = withRepeat(
      withTiming(1, { duration: speaking ? 620 : 1500, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(flow);
      cancelAnimation(breathe);
    };
  }, [active, breathe, flow, mood, reducedMotion, speaking]);

  useEffect(() => {
    cancelAnimation(blink);
    blink.value = 0;
    if (reducedMotion || !active) return;

    blink.value = withRepeat(
      withSequence(
        withDelay(2200, withTiming(1, { duration: 90 })),
        withTiming(0, { duration: 120 }),
        withDelay(1500, withTiming(0, { duration: 1 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(blink);
  }, [active, blink, reducedMotion]);

  useEffect(() => {
    cancelAnimation(mouth);
    mouth.value = 0;
    if (reducedMotion || !speaking) return;

    mouth.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(0.18, { duration: 190, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(mouth);
  }, [mouth, reducedMotion, speaking]);

  const companionStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(breathe.value, [0, 1], [1, speaking ? 1.035 : 1.018]) }],
  }));
  const blinkStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: interpolate(blink.value, [0, 1], [1, 0.12]) }],
  }));
  const speakingMouthStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(mouth.value, [0, 1], [0.82, 1.08]) },
      { scaleY: interpolate(mouth.value, [0, 1], [0.45, 1.18]) },
    ],
  }));

  const frameSize = Math.round(size * 1.28);
  const eyeWidth = Math.max(10, Math.round(size * 0.075));
  const eyeHeight = Math.round(eyeWidth * 1.18);
  const faceTop = Math.round(size * 0.39);
  const rippleStrength = speaking ? 0.34 : mood === 'thinking' || mood === 'connecting' ? 0.27 : 0.2;

  return (
    <View
      testID="voice-companion"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: frameSize, height: frameSize, alignItems: 'center', justifyContent: 'center' }}
    >
      <WaterRipple color={colors.accent.primary} offset={0} progress={flow} size={size} strength={rippleStrength} />
      <WaterRipple color={colors.accent.primary} offset={0.34} progress={flow} size={size} strength={rippleStrength * 0.8} />
      <WaterRipple color={colors.accent.primary} offset={0.67} progress={flow} size={size} strength={rippleStrength * 0.62} />

      <Animated.View
        style={[
          styles.face,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surface.elevated,
            borderColor: colors.border.subtle,
          },
          companionStyle,
        ]}
      >
        <XopcLogo size={size} />
        <Animated.View
          style={[
            styles.eyes,
            {
              top: faceTop,
              width: Math.round(size * 0.29),
            },
            blinkStyle,
          ]}
        >
          {[0, 1].map((eye) => (
            <View
              key={eye}
              style={[
                styles.eye,
                {
                  width: eyeWidth,
                  height: eyeHeight,
                  borderRadius: eyeWidth / 2,
                  backgroundColor: colors.text.primary,
                },
              ]}
            >
              <View
                style={[
                  {
                    width: Math.max(2, Math.round(eyeWidth * 0.28)),
                    height: Math.max(2, Math.round(eyeWidth * 0.28)),
                    borderRadius: eyeWidth,
                    backgroundColor: colors.surface.elevated,
                  },
                ]}
              />
            </View>
          ))}
        </Animated.View>

        {speaking ? (
          <Animated.View
            style={[
              styles.speakingMouth,
              {
                top: Math.round(size * 0.54),
                width: Math.round(size * 0.13),
                height: Math.round(size * 0.09),
                borderRadius: size,
                backgroundColor: colors.accent.primary,
              },
              speakingMouthStyle,
            ]}
          >
            <View style={styles.mouthShine} />
          </Animated.View>
        ) : mood === 'thinking' || mood === 'connecting' ? (
          <View
            style={[
              styles.thinkingMouth,
              {
                top: Math.round(size * 0.55),
                width: Math.round(size * 0.08),
                height: Math.round(size * 0.08),
                borderRadius: size,
                borderColor: colors.accent.primary,
              },
            ]}
          />
        ) : mood === 'offline' ? (
          <View
            style={[
              styles.neutralMouth,
              { top: Math.round(size * 0.57), width: Math.round(size * 0.13), backgroundColor: colors.text.tertiary },
            ]}
          />
        ) : (
          <View
            style={[
              styles.smile,
              {
                top: Math.round(size * 0.525),
                width: Math.round(size * 0.18),
                height: Math.round(size * 0.11),
                borderRadius: size,
                borderBottomColor: colors.accent.primary,
              },
            ]}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ripple: {
    position: 'absolute',
    borderWidth: 2,
  },
  brandMark: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  eyes: {
    position: 'absolute',
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eye: {
    alignItems: 'flex-end',
    paddingTop: 2,
    paddingRight: 2,
  },
  speakingMouth: {
    position: 'absolute',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  mouthShine: {
    width: '60%',
    height: '22%',
    marginBottom: '16%',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  thinkingMouth: {
    position: 'absolute',
    zIndex: 2,
    borderWidth: 2.5,
  },
  neutralMouth: {
    position: 'absolute',
    zIndex: 2,
    height: 3,
    borderRadius: 2,
  },
  smile: {
    position: 'absolute',
    zIndex: 2,
    borderBottomWidth: 3,
  },
});
