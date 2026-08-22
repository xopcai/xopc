import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Dialog, Icon, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';
import { useReadAloudStore } from './read-aloud-store';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function GlobalReadAloudPlayer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { chat: m } = useMessages();
  const source = useReadAloudStore((state) => state.source);
  const status = useReadAloudStore((state) => state.status);
  const error = useReadAloudStore((state) => state.error);
  const consentRequired = useReadAloudStore((state) => state.consentRequired);
  const currentChunkIndex = useReadAloudStore((state) => state.currentChunkIndex);
  const chunkCount = useReadAloudStore((state) => state.chunkCount);
  const currentTime = useReadAloudStore((state) => state.currentTime);
  const duration = useReadAloudStore((state) => state.duration);
  const rate = useReadAloudStore((state) => state.rate);
  const pause = useReadAloudStore((state) => state.pause);
  const resume = useReadAloudStore((state) => state.resume);
  const stop = useReadAloudStore((state) => state.stop);
  const retry = useReadAloudStore((state) => state.retry);
  const cycleRate = useReadAloudStore((state) => state.cycleRate);
  const acceptConsent = useReadAloudStore((state) => state.acceptConsent);
  const declineConsent = useReadAloudStore((state) => state.declineConsent);
  const visible = Boolean(source) && status !== 'idle';
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const errorMessage = error === 'empty'
    ? m.messageReadAloudEmpty
    : error === 'generation'
      ? m.messageReadAloudFailed
      : null;

  return (
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={status === 'playing'
                ? m.messageReadAloudPause
                : status === 'preparing'
                  ? m.messageReadAloudStop
                  : m.messageReadAloudResume}
              onPress={status === 'playing'
                ? pause
                : status === 'preparing'
                  ? stop
                  : status === 'error'
                    ? retry
                    : resume}
              style={[styles.playButton, { backgroundColor: colors.accent.primary }]}
            >
              <Icon
                source={status === 'preparing' ? 'loading' : status === 'playing' ? 'pause' : 'play'}
                size={20}
                color={colors.accent.onPrimary}
              />
            </Pressable>
            <View style={styles.body}>
              <Pressable
                disabled={!source?.sessionKey}
                onPress={source?.sessionKey
                  ? () => router.push(`/chat/${encodeURIComponent(source.sessionKey!)}`)
                  : undefined}
                accessibilityRole={source?.sessionKey ? 'button' : undefined}
              >
                <Text numberOfLines={1} style={[styles.title, { color: colors.text.primary }]}>
                  {source?.title}
                </Text>
              </Pressable>
              <View style={[styles.track, { backgroundColor: colors.border.default }]}>
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.accent.primary }]} />
              </View>
              <View style={styles.metaRow}>
                <Text numberOfLines={1} style={[styles.meta, { color: errorMessage ? colors.semantic.error : colors.text.tertiary }]}>
                  {errorMessage ?? `${formatTime(currentTime)} / ${duration > 0 ? formatTime(duration) : '—'} · ${currentChunkIndex + 1}/${chunkCount}`}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={m.messageReadAloudRate}
                  onPress={cycleRate}
                  style={styles.rateButton}
                >
                  <Text style={[styles.rate, { color: colors.text.secondary }]}>{rate}×</Text>
                </Pressable>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={m.messageReadAloudStop}
              onPress={stop}
              style={styles.closeButton}
            >
              <Icon source="close" size={19} color={colors.text.secondary} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <Dialog visible={consentRequired} onDismiss={declineConsent}>
        <Dialog.Title>{m.messageReadAloudConsentTitle}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">{m.messageReadAloudConsentDescription}</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={declineConsent}>{m.messageReadAloudConsentCancel}</Button>
          <Button onPress={acceptConsent}>{m.messageReadAloudConsentConfirm}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  player: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { ...typography.label, fontWeight: '600' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...typography.caption, flex: 1 },
  rateButton: { minWidth: 44, minHeight: 24, alignItems: 'flex-end', justifyContent: 'center' },
  rate: { ...typography.caption, fontWeight: '600' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
