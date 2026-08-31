import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PanResponder } from 'react-native';

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
  classifyVoiceTranscriptionFailure,
  deleteRecordingFile,
  discardRecording,
  finishRecording,
  inferRecordingMimeType,
  MAX_VOICE_RECORDING_MS,
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

function reportVoiceFailure(phase: string, error: unknown): void {
  console.warn(`[VoiceRecording] ${phase} failed`, error);
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
  onPress: () => void;
  prepare: () => Promise<boolean>;
  active: boolean;
  transcribing: boolean;
} {
  const { isDark } = useTheme();
  const { chat: cm } = useMessages();
  const [hudOpen, setHudOpen] = useState(false);
  const [voiceZone, setVoiceZone] = useState<VoiceRecordingZone>('center');
  const [meterSamples, setMeterSamples] = useState<number[]>([]);
  const [durationMillis, setDurationMillis] = useState(0);
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
  const justFinalizedAtRef = useRef(0);
  const maxDurationReachedRef = useRef(false);
  const finalizeRef = useRef<() => void>(() => {});
  const valueRef = useRef(value);
  const mountedRef = useRef(true);
  valueRef.current = value;

  useEffect(() => () => {
    mountedRef.current = false;
    abortStartRef.current = true;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) void discardRecording(recording);
  }, []);

  const resetInteractionState = useCallback(() => {
    recordingRef.current = null;
    readyRef.current = false;
    abortStartRef.current = false;
    grantInFlightRef.current = false;
    cancelZoneRef.current = false;
    releaseZoneRef.current = 'center';
    interactionStartedRef.current = false;
    maxDurationReachedRef.current = false;
    setStarting(false);
    setHudOpen(false);
    setVoiceZone('center');
    setMeterSamples([]);
    setDurationMillis(0);
  }, []);

  const ensureMicAccess = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await requestMicPermission();
      if (permission.granted) return true;
      if (mountedRef.current) {
        setSnack(permission.canAskAgain ? cm.voicePermissionDenied : cm.voicePermissionSettings);
      }
      return false;
    } catch (error) {
      reportVoiceFailure('permission', error);
      if (mountedRef.current) setSnack(cm.voicePermissionCheckFailed);
      return false;
    }
  }, [cm]);

  const finalizeRecordingInteraction = useCallback(async () => {
    const rec = recordingRef.current;
    const shouldDiscard = cancelZoneRef.current;
    const releaseZone = releaseZoneRef.current;

    justFinalizedAtRef.current = Date.now();
    resetInteractionState();

    if (!rec) return;

    if (shouldDiscard) {
      await discardRecording(rec);
      onSettled?.();
      return;
    }

    let uri: string | null;
    let durationMillis: number;
    try {
      ({ uri, durationMillis } = await finishRecording(rec));
    } catch (error) {
      reportVoiceFailure('stop', error);
      setSnack(cm.voiceRecordingFailed);
      onSettled?.();
      return;
    }
    if (durationMillis < MIN_VOICE_MS) {
      deleteRecordingFile(uri);
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
      } catch (error) {
        reportVoiceFailure('transcribe', error);
        const failure = classifyVoiceTranscriptionFailure(error);
        setSnack(
          failure === 'decoder_unavailable'
            ? cm.voiceDecoderUnavailable
            : failure === 'not_configured'
              ? cm.voiceSttNotConfigured
            : failure === 'runtime_unavailable'
              ? cm.voiceRuntimeUnavailable
              : cm.voiceTranscribeFailed,
        );
      } finally {
        deleteRecordingFile(uri);
        if (mountedRef.current) setTranscribing(false);
      }
      return;
    }

    onVoiceCapture({ uri, durationMillis, mimeType });
    onSettled?.();
  }, [cm, onChangeText, onSettled, onTextReady, onVoiceCapture, resetInteractionState]);
  finalizeRef.current = () => void finalizeRecordingInteraction();

  const startGrantFlow = useCallback(() => {
    if (!enabled || disabled || submitting || transcribing || grantInFlightRef.current) return;
    abortStartRef.current = false;
    readyRef.current = false;
    recordingRef.current = null;
    cancelZoneRef.current = false;
    releaseZoneRef.current = 'center';
    interactionStartedRef.current = true;
    maxDurationReachedRef.current = false;
    setVoiceZone('center');
    setMeterSamples([]);
    setDurationMillis(0);
    setStarting(true);
    grantInFlightRef.current = true;

    void (async () => {
      const ok = await ensureMicAccess();
      if (!ok) {
        grantInFlightRef.current = false;
        interactionStartedRef.current = false;
        setStarting(false);
        return;
      }
      try {
        const rec = await beginRecording((metering, nextDurationMillis) => {
          if (mountedRef.current) {
            setMeterSamples((prev) => [...prev.slice(-47), meteringToLevel(metering)]);
            setDurationMillis(nextDurationMillis);
            if (
              nextDurationMillis >= MAX_VOICE_RECORDING_MS
              && !maxDurationReachedRef.current
              && recordingRef.current
            ) {
              maxDurationReachedRef.current = true;
              setSnack(cm.voiceMaxDurationReached);
              finalizeRef.current();
            }
          }
        }, { persistent: true });
        if (!mountedRef.current || abortStartRef.current) {
          await discardRecording(rec);
          if (!mountedRef.current) return;
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
      } catch (error) {
        if (!mountedRef.current) return;
        reportVoiceFailure('start', error);
        grantInFlightRef.current = false;
        interactionStartedRef.current = false;
        setStarting(false);
        setSnack(cm.voiceRecordingStartFailed);
      }
    })();
  }, [cm, disabled, enabled, ensureMicAccess, submitting, transcribing]);

  const canCaptureVoice = enabled && !disabled && !submitting && !transcribing;

  const prepare = useCallback(async () => {
    if (disabled || submitting || transcribing) return false;
    return ensureMicAccess();
  }, [disabled, ensureMicAccess, submitting, transcribing]);

  const handlePress = useCallback(() => {
    if (Date.now() - justFinalizedAtRef.current < 250) return;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (readyRef.current && recordingRef.current) {
      cancelZoneRef.current = false;
      releaseZoneRef.current = 'center';
      void finalizeRecordingInteraction();
      return;
    }
    if (interactionStartedRef.current || grantInFlightRef.current || starting) return;
    if (!canCaptureVoice) {
      onTap?.();
      return;
    }
    startGrantFlow();
  }, [canCaptureVoice, finalizeRecordingInteraction, onTap, starting, startGrantFlow]);

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
          durationMillis={durationMillis}
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
    onPress: handlePress,
    prepare,
    active: starting || hudOpen || transcribing,
    transcribing,
  };
}
