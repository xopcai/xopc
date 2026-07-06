/**
 * Voice overlay: center sends voice, left cancels, right converts to text.
 */
import { memo, useMemo } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { getColors } from '../../theme';
import { VoiceMeterBars } from './VoiceMeterBars';

export type VoiceRecordingZone = 'center' | 'cancel' | 'text';

export const VoiceRecordingOverlay = memo(function VoiceRecordingOverlay({
  visible,
  zone,
  transcribing,
  meterSamples,
  centerHint,
  textHint,
  textGlyph,
  cancelHint,
  transcribingLabel,
  isDark,
}: {
  visible: boolean;
  zone: VoiceRecordingZone;
  transcribing: boolean;
  meterSamples: number[];
  centerHint: string;
  textHint: string;
  textGlyph: string;
  cancelHint: string;
  transcribingLabel: string;
  isDark: boolean;
}) {
  const colors = getColors(isDark);
  const accent = colors.accent.primary;
  const waveTrack = colors.accent.selectionBg;
  const bubbleBg = colors.surface.panel;
  const sideIdle = colors.surface.active;
  const sideActiveCancel = colors.semantic.errorBold;
  const sideActiveText = colors.accent.primary;

  const mainHint = useMemo(() => {
    if (transcribing) return transcribingLabel;
    if (zone === 'cancel') return cancelHint;
    if (zone === 'text') return textHint;
    return centerHint;
  }, [transcribing, zone, centerHint, textHint, cancelHint, transcribingLabel]);

  const mainHintColor = transcribing
    ? accent
    : zone === 'cancel'
      ? colors.semantic.errorBold
      : colors.accent.onPrimary;

  const showCancelHint = !transcribing && zone === 'cancel';
  const showTextHint = !transcribing && zone === 'text';

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay.scrim }]} pointerEvents="none">
        <View style={styles.content}>
          <View style={styles.bubbleSection}>
            <View style={[styles.bubble, { backgroundColor: bubbleBg }]}>
              {transcribing ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <VoiceMeterBars samples={meterSamples} accentColor={colors.semantic.success} trackColor={waveTrack} />
              )}
            </View>
            <Text style={[styles.mainHint, { color: mainHintColor }]} numberOfLines={2}>
              {mainHint}
            </Text>
          </View>

          {!transcribing ? (
            <View style={styles.actionBand}>
              <View style={styles.actionSlot}>
                {showCancelHint ? (
                  <Text style={[styles.actionHint, styles.actionHintCancel, { color: colors.semantic.errorBold }]}>
                    {cancelHint}
                  </Text>
                ) : (
                  <View style={styles.actionHintPlaceholder} />
                )}
                <View
                  style={[
                    styles.sideBtn,
                    { backgroundColor: zone === 'cancel' ? sideActiveCancel : sideIdle },
                  ]}
                >
                  <Icon source="close" size={26} color={colors.accent.onPrimary} />
                </View>
              </View>

              <View style={styles.actionSlot}>
                {showTextHint ? (
                  <Text style={[styles.actionHint, { color: colors.accent.onPrimary }]}>{textHint}</Text>
                ) : (
                  <View style={styles.actionHintPlaceholder} />
                )}
                <View
                  style={[
                    styles.sideBtn,
                    { backgroundColor: zone === 'text' ? sideActiveText : sideIdle },
                  ]}
                >
                  <Text style={[styles.zoneChar, { color: colors.accent.onPrimary }]}>{textGlyph}</Text>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.bottomArc}>
            <View style={[styles.arcInner, { backgroundColor: colors.surface.input }]}>
              <Icon source="microphone-outline" size={26} color={colors.text.secondary} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bubbleSection: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 20,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 18,
    minWidth: 168,
    maxWidth: 280,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  mainHint: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 280,
  },
  actionBand: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingBottom: 12,
    minHeight: 96,
  },
  actionSlot: {
    width: 72,
    alignItems: 'center',
    gap: 10,
  },
  actionHint: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    minHeight: 18,
  },
  actionHintCancel: {
    fontWeight: '700',
  },
  actionHintPlaceholder: {
    minHeight: 18,
  },
  sideBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneChar: {
    fontSize: 20,
    fontWeight: '700',
  },
  bottomArc: {
    alignItems: 'center',
    paddingBottom: 0,
  },
  arcInner: {
    width: '100%',
    height: 80,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 16,
  },
});
