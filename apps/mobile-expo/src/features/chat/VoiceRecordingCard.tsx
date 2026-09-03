import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useTheme } from '@/theme';
import { VoiceMeterBars } from './VoiceMeterBars';

export const VoiceRecordingCard = memo(function VoiceRecordingCard({
  visible, processing, cancelled, meterSamples, durationMillis = 0, hint,
}: {
  visible: boolean;
  processing: boolean;
  cancelled: boolean;
  meterSamples: number[];
  durationMillis?: number;
  hint: string;
}) {
  const { colors } = useTheme();
  if (!visible) return null;
  const color = cancelled ? colors.semantic.errorBold : colors.text.secondary;
  return (
    <View style={styles.anchor}>
      <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
        {processing ? (
          <View style={styles.processingRow} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={color} />
            <Text style={[styles.hint, { color }]}>{hint}</Text>
          </View>
        ) : (
          <>
            <View style={styles.meterRow}>
              <View style={[styles.recordDot, { backgroundColor: colors.semantic.errorBold }]} />
              <VoiceMeterBars samples={meterSamples} accentColor={colors.accent.primary} trackColor={colors.accent.selectionBg} />
              <Text style={[styles.duration, { color }]}>{formatRecordingDuration(durationMillis)}</Text>
            </View>
            <View style={styles.hintRow} accessibilityLiveRegion="polite">
              <Text style={[styles.hint, { color }]}>{hint}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
});

export function formatRecordingDuration(durationMillis: number): string {
  const seconds = Math.max(0, Math.floor(durationMillis / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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
});
