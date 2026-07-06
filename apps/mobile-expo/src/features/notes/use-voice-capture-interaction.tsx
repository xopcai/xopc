import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PanResponder, Platform } from 'react-native';

import { AppToast } from '../../components/AppToast';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_LONG } from '../../constants/toast';
import { transcribeVoice } from '../../api/agent-client';
import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import {
  VoiceRecordingOverlay,
  type VoiceRecordingZone,
} from '../chat/VoiceRecordingOverlay';
import {
  beginRecording,
  discardRecording,
  finishRecording,
  inferRecordingMimeType,
  meteringToLevel,
  requestMicPermission,
  type ExpoRecording,
} from '../chat/voiceRecording';

const ZONE_CANCEL_DX = -72;
const ZONE_TEXT_DX = 72;
const MIN_VOICE_MS = 380;

function voiceZoneFromGesture(dx: number): VoiceRecordingZone {
  if (dx < ZONE_CANCEL_DX) return 'cancel';
  if (dx > ZONE_TEXT_DX) return 'text';
  return 'center';
}

export type VoiceCapturePayload = {
  uri: string;
  durationMillis: number;
  mimeType: string;
};

export function useVoiceCaptureInteraction({
  value,
  onChangeText,
  onVoiceCapture,
  onTap,
  onTextReady,
  onSettled,
  disabled = false,
  submitting = false,
  enabled = true,
  longPressDelayMs = 0,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onVoiceCapture: (payload: VoiceCapturePayload) => void;
  onTap?: () => void;
  onTextReady?: (text: string) => void;
  onSettled?: () => void;
  disabled?: boolean;
  submitting?: boolean;
  enabled?: boolean;
  longPressDelayMs?: number;
}): {
  feedback: ReactNode;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  active: boolean;
  transcribing: boolean;
} {
  const { isDark } = useTheme();
  const { chat: cm } = useMessages();
  const [hudOpen, setHudOpen] = useState(false);
  const [voiceZone, setVoiceZone] = useState<VoiceRecordingZone>('center');
  const [meterSamples, setMeterSamples] = useState<number[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [snack, setSnack] = useState('');

  const recordingRef = useRef<ExpoRecording | null>(null);
  const readyRef = useRef(false);
  const abortStartRef = useRef(false);
  const cancelZoneRef = useRef(false);
  const releaseZoneRef = useRef<VoiceRecordingZone>('center');
  const grantInFlightRef = useRef(false);
  const interactionStartedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const resetInteractionState = useCallback(() => {
    recordingRef.current = null;
    readyRef.current = false;
    abortStartRef.current = false;
    grantInFlightRef.current = false;
    cancelZoneRef.current = false;
    releaseZoneRef.current = 'center';
    interactionStartedRef.current = false;
    setStarting(false);
    setHudOpen(false);
    setVoiceZone('center');
    setMeterSamples([]);
  }, []);

  const finalizeRecordingInteraction = useCallback(async () => {
    const rec = recordingRef.current;
    const shouldDiscard = cancelZoneRef.current;
    const releaseZone = releaseZoneRef.current;

    resetInteractionState();

    if (!rec) return;

    if (shouldDiscard) {
      await discardRecording(rec);
      onSettled?.();
      return;
    }

    try {
      const { uri, durationMillis } = await finishRecording(rec);
      if (durationMillis < MIN_VOICE_MS) {
        setSnack(cm.voiceTooShort);
        onSettled?.();
        return;
      }
      if (!uri) {
        setSnack(cm.voiceRecordingFailed);
        onSettled?.();
        return;
      }

      const mimeType = inferRecordingMimeType(uri);

      if (releaseZone === 'text') {
        setTranscribing(true);
        try {
          const result = await transcribeVoice(uri, mimeType);
          const text = (result.refined || result.raw).trim();
          if (text) {
            const current = valueRef.current.trim();
            const nextText = current ? `${current} ${text}` : text;
            onChangeText(nextText);
            onTextReady?.(nextText);
            onSettled?.();
          } else {
            setSnack(cm.voiceNoSpeechDetected);
          }
        } catch {
          setSnack(cm.voiceTranscribeFailed);
        } finally {
          setTranscribing(false);
        }
        return;
      }

      onVoiceCapture({ uri, durationMillis, mimeType });
      onSettled?.();
    } catch {
      setSnack(cm.voiceRecordingFailed);
      onSettled?.();
    }
  }, [cm, onChangeText, onSettled, onTextReady, onVoiceCapture, resetInteractionState]);

  const startGrantFlow = useCallback(() => {
    if (!enabled || disabled || submitting || transcribing || grantInFlightRef.current) return;
    abortStartRef.current = false;
    readyRef.current = false;
    recordingRef.current = null;
    cancelZoneRef.current = false;
    releaseZoneRef.current = 'center';
    interactionStartedRef.current = true;
    setVoiceZone('center');
    setMeterSamples([]);
    setStarting(true);
    grantInFlightRef.current = true;

    if (Platform.OS === 'web') {
      grantInFlightRef.current = false;
      interactionStartedRef.current = false;
      setStarting(false);
      setSnack(cm.voiceWebUnsupported);
      return;
    }

    void (async () => {
      const ok = await requestMicPermission();
      if (!ok) {
        grantInFlightRef.current = false;
        interactionStartedRef.current = false;
        setStarting(false);
        setSnack(cm.voicePermissionDenied);
        return;
      }
      try {
        const rec = await beginRecording((metering) => {
          setMeterSamples((prev) => [...prev.slice(-47), meteringToLevel(metering)]);
        });
        if (abortStartRef.current) {
          await discardRecording(rec);
          grantInFlightRef.current = false;
          interactionStartedRef.current = false;
          setStarting(false);
          return;
        }
        recordingRef.current = rec;
        readyRef.current = true;
        grantInFlightRef.current = false;
        setStarting(false);
        setHudOpen(true);
      } catch {
        grantInFlightRef.current = false;
        interactionStartedRef.current = false;
        setStarting(false);
        setSnack(cm.voiceRecordingFailed);
      }
    })();
  }, [cm, disabled, enabled, submitting, transcribing]);

  const canCaptureVoice = enabled && !disabled && !submitting && !transcribing;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canCaptureVoice,
        onMoveShouldSetPanResponder: () => interactionStartedRef.current,
        onPanResponderGrant: () => {
          cancelZoneRef.current = false;
          releaseZoneRef.current = 'center';
          setVoiceZone('center');
          if (longPressDelayMs > 0) {
            longPressTimerRef.current = setTimeout(() => {
              longPressTimerRef.current = null;
              startGrantFlow();
            }, longPressDelayMs);
            return;
          }
          startGrantFlow();
        },
        onPanResponderMove: (_, g) => {
          if (!interactionStartedRef.current) return;
          const zone = voiceZoneFromGesture(g.dx);
          cancelZoneRef.current = zone === 'cancel';
          releaseZoneRef.current = zone;
          setVoiceZone(zone);
        },
        onPanResponderRelease: () => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            onTap?.();
            return;
          }
          if (!interactionStartedRef.current) return;
          if (!readyRef.current) {
            abortStartRef.current = true;
            return;
          }
          void finalizeRecordingInteraction();
        },
        onPanResponderTerminate: () => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            return;
          }
          if (!interactionStartedRef.current) return;
          if (!readyRef.current) {
            abortStartRef.current = true;
            return;
          }
          cancelZoneRef.current = true;
          releaseZoneRef.current = 'center';
          setVoiceZone('cancel');
          void finalizeRecordingInteraction();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [canCaptureVoice, finalizeRecordingInteraction, longPressDelayMs, onTap, startGrantFlow],
  );

  return {
    feedback: (
      <>
        <VoiceRecordingOverlay
          visible={hudOpen || transcribing}
          zone={voiceZone}
          transcribing={transcribing}
          meterSamples={meterSamples}
          centerHint={cm.voiceReleaseCenterHint}
          textHint={cm.voiceReleaseTextHint}
          textGlyph={cm.voiceTextGlyph}
          cancelHint={cm.voiceReleaseCancelHint}
          transcribingLabel={cm.voiceTranscribing}
          isDark={isDark}
        />
        <AppToast
          visible={Boolean(snack)}
          onDismiss={() => setSnack('')}
          duration={TOAST_DURATION_LONG}
          bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
        >
          {snack}
        </AppToast>
      </>
    ),
    panHandlers: panResponder.panHandlers,
    active: starting || hudOpen || transcribing,
    transcribing,
  };
}
