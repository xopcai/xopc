/** Compact recording feedback that stays anchored to the composer. */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { Icon } from 'react-native-paper';

import { radii, spacing, typography, useTheme } from '../../theme';
import {
  claimAudioPlayback,
  releaseAudioPlayback,
} from '../voice/audio-playback-coordinator';
import { VoiceMeterBars } from './VoiceMeterBars';

export type VoiceRecordingZone = 'center' | 'cancel' | 'text' | 'lock';
export type VoiceRecordingStage =
  | 'starting'
  | 'recording'
  | 'locked'
  | 'review'
  | 'transcribing'
  | 'sending';

export const VoiceRecordingCard = memo(function VoiceRecordingCard({
  visible,
  stage,
  zone,
  meterSamples,
  durationMillis,
  centerHint,
  textHint,
  cancelHint,
  lockHint,
  startingLabel,
  lockedLabel,
  reviewLabel,
  transcribingLabel,
  sendingLabel,
  deleteLabel,
  stopLabel,
  convertTextLabel,
  sendLabel,
  playLabel,
  pauseLabel,
  previewUri,
  dragX,
  dragY,
  onDelete,
  onStop,
  onConvertText,
  onSend,
  onPlaybackError,
}: {
  visible: boolean;
  stage: VoiceRecordingStage;
  zone: VoiceRecordingZone;
  meterSamples: number[];
  durationMillis?: number;
  centerHint: string;
  textHint: string;
  cancelHint: string;
  lockHint: string;
  startingLabel: string;
  lockedLabel: string;
  reviewLabel: string;
  transcribingLabel: string;
  sendingLabel: string;
  deleteLabel: string;
  stopLabel: string;
  convertTextLabel: string;
  sendLabel: string;
  playLabel: string;
  pauseLabel: string;
  previewUri?: string | null;
  dragX?: SharedValue<number>;
  dragY?: SharedValue<number>;
  onDelete?: () => void;
  onStop?: () => void;
  onConvertText?: () => void;
  onSend?: () => void;
  onPlaybackError?: () => void;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const playback = useRecordingPreviewPlayback(stage === 'review' ? previewUri : null, onPlaybackError);
  const processing = stage === 'starting' || stage === 'transcribing' || stage === 'sending';
  const mainHint = useMemo(() => {
    if (stage === 'starting') return startingLabel;
    if (stage === 'transcribing') return transcribingLabel;
    if (stage === 'sending') return sendingLabel;
    if (stage === 'locked') return lockedLabel;
    if (stage === 'review') return reviewLabel;
    if (zone === 'cancel') return cancelHint;
    if (zone === 'text') return textHint;
    if (zone === 'lock') return lockHint;
    return centerHint;
  }, [
    cancelHint,
    centerHint,
    lockHint,
    lockedLabel,
    reviewLabel,
    sendingLabel,
    stage,
    startingLabel,
    textHint,
    transcribingLabel,
    zone,
  ]);
  const stateColor = zone === 'cancel'
    ? colors.semantic.errorBold
    : zone === 'text' || zone === 'lock'
      ? colors.accent.primary
      : colors.text.secondary;
  const stateIcon = zone === 'cancel'
    ? 'trash-can-outline'
    : zone === 'text'
      ? 'text-box-outline'
      : zone === 'lock' || stage === 'locked'
        ? 'lock-outline'
        : 'microphone-outline';

  const followStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: reduceMotion || !dragX
          ? 0
          : interpolate(dragX.value, [-140, 0, 140], [-12, 0, 12], 'clamp'),
      },
      {
        translateY: reduceMotion || !dragY
          ? 0
          : interpolate(dragY.value, [-140, 0], [-8, 0], 'clamp'),
      },
    ],
  }), [dragX, dragY, reduceMotion]);

  if (!visible) return null;

  return (
    <View style={styles.anchor}>
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface.panel,
            borderColor: zone === 'center' ? colors.border.default : stateColor,
          },
          followStyle,
        ]}
      >
        {processing ? (
          <View style={styles.processingRow} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.accent.primary} />
            <Text style={[styles.hint, { color: colors.accent.primary }]}>{mainHint}</Text>
          </View>
        ) : (
          <>
            <View style={styles.meterRow}>
              {stage === 'recording' || stage === 'locked' ? (
                <View style={[styles.recordDot, { backgroundColor: colors.semantic.errorBold }]} />
              ) : (
                <Icon source="waveform" size={16} color={colors.accent.primary} />
              )}
              <VoiceMeterBars
                samples={meterSamples}
                accentColor={colors.accent.primary}
                trackColor={colors.accent.selectionBg}
              />
              <Text style={[styles.duration, { color: colors.text.secondary }]}>
                {formatRecordingDuration(durationMillis ?? 0)}
              </Text>
            </View>

            {stage === 'review' ? (
              <>
                <View style={styles.hintRow} accessibilityLiveRegion="polite">
                  <Icon source="check-circle-outline" size={16} color={colors.text.secondary} />
                  <Text style={[styles.hint, { color: colors.text.secondary }]}>{reviewLabel}</Text>
                </View>
                <View style={styles.reviewActions}>
                  <ActionButton
                    icon="trash-can-outline"
                    label={deleteLabel}
                    color={colors.semantic.errorBold}
                    onPress={onDelete}
                  />
                  <CircleButton
                    icon={playback.playing ? 'pause' : 'play'}
                    label={playback.playing ? pauseLabel : playLabel}
                    loading={playback.loading}
                    backgroundColor={colors.surface.active}
                    color={colors.text.primary}
                    onPress={playback.toggle}
                  />
                  <ActionButton
                    icon="text-box-outline"
                    label={convertTextLabel}
                    color={colors.text.primary}
                    onPress={onConvertText}
                  />
                  <CircleButton
                    icon="arrow-up"
                    label={sendLabel}
                    backgroundColor={colors.accent.primary}
                    color={colors.accent.onPrimary}
                    onPress={onSend}
                  />
                </View>
              </>
            ) : stage === 'locked' ? (
              <>
                <View style={styles.hintRow} accessibilityLiveRegion="polite">
                  <Icon source="lock-outline" size={16} color={colors.accent.primary} />
                  <Text style={[styles.hint, { color: colors.accent.primary }]}>{lockedLabel}</Text>
                </View>
                <View style={styles.lockedActions}>
                  <ActionButton
                    icon="trash-can-outline"
                    label={deleteLabel}
                    color={colors.semantic.errorBold}
                    onPress={onDelete}
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.stopButton,
                      {
                        backgroundColor: colors.text.primary,
                        opacity: pressed ? 0.76 : 1,
                      },
                    ]}
                    onPress={onStop}
                    accessibilityRole="button"
                    accessibilityLabel={stopLabel}
                  >
                    <Icon source="stop" size={18} color={colors.text.inverse} />
                    <Text style={[styles.stopLabel, { color: colors.text.inverse }]}>{stopLabel}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.hintRow} accessibilityLiveRegion="polite">
                <Icon source={stateIcon} size={16} color={stateColor} />
                <Text style={[styles.hint, { color: stateColor }]} numberOfLines={1}>{mainHint}</Text>
              </View>
            )}
          </>
        )}
      </Animated.View>
    </View>
  );
});

function ActionButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        { opacity: !onPress ? 0.42 : pressed ? 0.62 : 1 },
      ]}
      onPress={() => onPress?.()}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon source={icon} size={18} color={color} />
      <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function CircleButton({
  icon,
  label,
  loading = false,
  backgroundColor,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  loading?: boolean;
  backgroundColor: string;
  color: string;
  onPress?: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.circleButton,
        { backgroundColor, opacity: !onPress ? 0.42 : pressed || loading ? 0.68 : 1 },
      ]}
      onPress={() => void onPress?.()}
      disabled={!onPress || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Icon source={icon} size={19} color={color} />
      )}
    </Pressable>
  );
}

function useRecordingPreviewPlayback(uri?: string | null, onError?: () => void) {
  const ownerId = useId();
  const playerRef = useRef<AudioPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const unload = useCallback(() => {
    releaseAudioPlayback(ownerId);
    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      player.remove();
    } catch {
      // The native player may already be released during source replacement.
    }
  }, [ownerId]);

  useEffect(() => {
    unload();
    setPlaying(false);
    setLoading(false);
    return unload;
  }, [unload, uri]);

  const ensurePlayer = useCallback(async () => {
    if (playerRef.current) return playerRef.current;
    if (!uri) throw new Error('Missing recording preview source');
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const player = createAudioPlayer({ uri }, { updateInterval: 250 });
    player.addListener('playbackStatusUpdate', (status) => {
      if (!status.isLoaded) {
        setPlaying(false);
        return;
      }
      setPlaying(status.playing);
      if (status.didJustFinish) {
        releaseAudioPlayback(ownerId);
        setPlaying(false);
        void player.seekTo(0).catch(() => undefined);
      }
    });
    playerRef.current = player;
    return player;
  }, [ownerId, uri]);

  const toggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const player = await ensurePlayer();
      if (player.playing) {
        player.pause();
        releaseAudioPlayback(ownerId);
      } else {
        claimAudioPlayback(ownerId, () => player.pause());
        player.play();
      }
    } catch {
      releaseAudioPlayback(ownerId);
      setPlaying(false);
      onError?.();
    } finally {
      setLoading(false);
    }
  }, [ensurePlayer, loading, onError, ownerId]);

  return { loading, playing, toggle };
}

export function formatRecordingDuration(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  anchor: {
    paddingBottom: spacing.sm,
  },
  card: {
    minHeight: 82,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  },
  meterRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
  },
  duration: {
    ...typography.caption,
    minWidth: 42,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  hintRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  hint: {
    ...typography.caption,
    fontWeight: '500',
    textAlign: 'center',
  },
  processingRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  reviewActions: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  lockedActions: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 56,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionLabel: {
    ...typography.caption,
    fontWeight: '500',
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButton: {
    minWidth: 112,
    minHeight: 44,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  stopLabel: {
    ...typography.label,
    fontWeight: '600',
  },
});
