import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';
import { useVoiceCall } from './voice-call';
import { useReadAloudStore } from './read-aloud-store';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function GlobalReadAloudPlayer() {
  const router = useRouter();
  const call = useVoiceCall();
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { chat: m } = useMessages();
  const source = useReadAloudStore((state) => state.source);
  const status = useReadAloudStore((state) => state.status);
  const error = useReadAloudStore((state) => state.error);
  const currentTime = useReadAloudStore((state) => state.currentTime);
  const duration = useReadAloudStore((state) => state.duration);
  const rate = useReadAloudStore((state) => state.rate);
  const pause = useReadAloudStore((state) => state.pause);
  const resume = useReadAloudStore((state) => state.resume);
  const stop = useReadAloudStore((state) => state.stop);
  const retry = useReadAloudStore((state) => state.retry);
  const cycleRate = useReadAloudStore((state) => state.cycleRate);
  const visible = Boolean(source) && status !== 'idle' && call.phase === 'idle';
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const errorMessage = error === 'empty'
    ? m.messageReadAloudEmpty
    : error === 'generation'
      ? m.messageReadAloudFailed
      : null;
  const statusTitle = status === 'preparing'
    ? m.messageReadAloudPreparing
    : status === 'playing'
      ? m.messageReadAloudPlaying
      : status === 'paused'
        ? m.messageReadAloudPaused
        : m.messageReadAloudFailed;
  const statusDetail = errorMessage
    ?? (status === 'preparing'
      ? source?.title
      : `${formatTime(currentTime)} / ${duration > 0 ? formatTime(duration) : '—'}`);
  const handlePrimaryPress = status === 'playing'
    ? pause
    : status === 'preparing'
      ? stop
      : status === 'error'
        ? retry
        : resume;
  const primaryAccessibilityLabel = status === 'playing'
    ? m.messageReadAloudPause
    : status === 'preparing'
      ? m.messageReadAloudStop
      : status === 'error'
        ? m.messageReadAloudRetry
        : m.messageReadAloudResume;
  const primaryIcon = status === 'preparing'
    ? 'stop'
    : status === 'playing'
      ? 'pause'
      : status === 'error'
        ? 'refresh'
        : 'play';

  useEffect(() => {
    if (!visible) setPlayerExpanded(false);
  }, [visible]);

  const openSourceChat = () => {
    if (!source?.sessionKey) return;
    setPlayerExpanded(false);
    router.push(`/chat/${encodeURIComponent(source.sessionKey)}`);
  };

  const endPlayback = () => {
    setPlayerExpanded(false);
    stop();
  };

  return (
    <>
      <Portal>
        {visible ? (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
              style={[
                styles.player,
                {
                  bottom: insets.bottom + 82,
                  backgroundColor: colors.surface.panel,
                  borderColor: colors.border.default,
                },
              ]}
            >
              <View style={[styles.voiceMark, { backgroundColor: colors.accent.selectionBg }]}>
                {status === 'preparing' ? (
                  <ActivityIndicator size={18} color={colors.accent.primary} />
                ) : (
                  <Icon
                    source={status === 'error' ? 'alert-circle-outline' : 'waveform'}
                    size={21}
                    color={status === 'error' ? colors.semantic.error : colors.accent.primary}
                  />
                )}
              </View>
              <Pressable
                style={styles.body}
                onPress={() => setPlayerExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel={m.messageReadAloudOpenPlayer}
              >
                <Text numberOfLines={1} style={[styles.title, { color: colors.text.primary }]}>
                  {statusTitle}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.meta, { color: errorMessage ? colors.semantic.error : colors.text.tertiary }]}
                >
                  {statusDetail}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={primaryAccessibilityLabel}
                onPress={handlePrimaryPress}
                style={[styles.playButton, { backgroundColor: colors.accent.primary }]}
              >
                <Icon
                  source={primaryIcon}
                  size={20}
                  color={colors.accent.onPrimary}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.messageReadAloudStop}
                onPress={endPlayback}
                style={styles.closeButton}
              >
                <Icon source="close" size={19} color={colors.text.secondary} />
              </Pressable>
              <View style={[styles.track, { backgroundColor: colors.border.default }]}>
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.accent.primary }]} />
              </View>
            </View>
          </View>
        ) : null}

      </Portal>

      <BottomSheetModal
        visible={playerExpanded && visible}
        onDismiss={() => setPlayerExpanded(false)}
        title={m.messageReadAloudPlayerTitle}
        subtitle={errorMessage ?? statusTitle}
        maxHeight={480}
        footer={(
          <Button mode="contained-tonal" icon="close" onPress={endPlayback}>
            {m.messageReadAloudEnd}
          </Button>
        )}
      >
        <View style={styles.sheetContent}>
          <View style={[styles.previewCard, { backgroundColor: colors.surface.grouped }]}>
            <Text numberOfLines={4} style={[styles.previewText, { color: colors.text.secondary }]}>
              {source?.preview || source?.title}
            </Text>
          </View>

          <View style={styles.progressBlock}>
            <View style={[styles.sheetTrack, { backgroundColor: colors.border.default }]}>
              <View style={[styles.sheetFill, { width: `${progress * 100}%`, backgroundColor: colors.accent.primary }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={[styles.timeText, { color: colors.text.tertiary }]}>{formatTime(currentTime)}</Text>
              <Text style={[styles.timeText, { color: colors.text.tertiary }]}>
                {duration > 0 ? formatTime(duration) : '—'}
              </Text>
            </View>
          </View>

          <View style={styles.sheetControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={m.messageReadAloudRate}
              onPress={cycleRate}
              style={styles.secondaryControl}
            >
              <Text style={[styles.rateText, { color: colors.text.secondary }]}>{rate}×</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={primaryAccessibilityLabel}
              onPress={handlePrimaryPress}
              style={[styles.sheetPrimaryControl, { backgroundColor: colors.accent.primary }]}
            >
              <Icon
                source={primaryIcon}
                size={26}
                color={colors.accent.onPrimary}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={m.messageReadAloudBackToChat}
              disabled={!source?.sessionKey}
              onPress={openSourceChat}
              style={[styles.secondaryControl, !source?.sessionKey && styles.controlDisabled]}
            >
              <Icon source="message-text-outline" size={21} color={colors.text.secondary} />
              <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>
                {m.messageReadAloudBackToChat}
              </Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  player: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  voiceMark: {
    width: 40,
    height: 40,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: spacing.xxs, justifyContent: 'center' },
  title: { ...typography.label, fontWeight: '600' },
  track: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  fill: { height: 2, borderRadius: 1 },
  meta: { ...typography.micro },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.xl,
  },
  previewCard: {
    minHeight: 88,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: 'center',
  },
  previewText: { ...typography.body },
  progressBlock: { gap: spacing.xs },
  sheetTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  sheetFill: { height: 4, borderRadius: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeText: { ...typography.micro },
  sheetControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  secondaryControl: {
    width: 72,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  rateText: { ...typography.ui, fontWeight: '600' },
  controlLabel: { ...typography.micro, textAlign: 'center' },
  controlDisabled: { opacity: 0.4 },
  sheetPrimaryControl: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
