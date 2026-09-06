import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PanResponder } from 'react-native';
import { useMutation } from '@tanstack/react-query';

import { transcribeVoice } from '@/api/agent-client';
import { useMessages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { hapticVoiceCancel, hapticVoiceStart, hapticVoiceZoneChange } from '@/motion/haptics';
import type { WireAttachment } from './composer.types';
import {
  beginRecording, deleteRecordingFile, discardRecording, finishRecording,
  inferRecordingMimeType, MAX_VOICE_RECORDING_MS, meteringToLevel,
  requestMicPermission, type ExpoRecording,
} from './voiceRecording';
import { resolveVoiceRecordingDestination, type VoiceRecordingDestination } from './voiceRecordingGesture';

/** Capture owns the microphone; the message owns the file once handed off. */
export function useChatVoiceRecording({ sessionKey, disabled, onRecorded, onTranscribed, onRecordingDraft, onError }: {
  sessionKey: string;
  disabled: boolean;
  onRecorded: (attachment: WireAttachment) => Promise<void>;
  onTranscribed: (text: string) => void;
  onRecordingDraft: (attachment: WireAttachment) => void;
  onError: (message: string) => void;
}) {
  const m = useMessages().chat;
  const gatewayId = useGatewayStore(state => state.activeGatewayId);
  const [stage, setStage] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing'>('idle');
  const [destination, setDestination] = useState<VoiceRecordingDestination>('send');
  const { mutateAsync: transcribe } = useMutation({
    mutationFn: (attachment: WireAttachment) => transcribeVoice(attachment.localUri!, attachment.mimeType!),
    retry: false,
    networkMode: 'always',
  });
  const [samples, setSamples] = useState<number[]>([]);
  const [durationMillis, setDurationMillis] = useState(0);
  const recorderRef = useRef<ExpoRecording | null>(null);
  const heldRef = useRef(false);
  const busyRef = useRef(false);
  const destinationRef = useRef<VoiceRecordingDestination>('send');
  const generationRef = useRef(0);
  const finishRef = useRef<() => void>(() => {});

  const cancel = useCallback(() => {
    generationRef.current++;
    heldRef.current = false;
    busyRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) void discardRecording(recorder);
    setStage('idle');
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') cancel();
    });
    return () => {
      subscription.remove();
      cancel();
    };
  }, [cancel, gatewayId, sessionKey]);

  const finish = useCallback(async () => {
    heldRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    const generation = generationRef.current;
    const target = destinationRef.current;
    setStage('stopping');
    try {
      if (target === 'cancel') {
        await discardRecording(recorder);
        hapticVoiceCancel();
        return;
      }
      const recording = await finishRecording(recorder);
      if (generation !== generationRef.current) {
        deleteRecordingFile(recording.uri);
        return;
      }
      if (!recording.uri || recording.durationMillis < 380) {
        deleteRecordingFile(recording.uri);
        onError(m.voiceTooShort);
        return;
      }
      const attachment: WireAttachment = {
        type: 'voice',
        localUri: recording.uri,
        mimeType: inferRecordingMimeType(recording.uri),
        name: 'voice.m4a',
        durationSeconds: recording.durationMillis / 1000,
      };
      if (target === 'text') {
        setStage('transcribing');
        try {
          const result = await transcribe(attachment);
          if (generation !== generationRef.current) {
            deleteRecordingFile(recording.uri);
            return;
          }
          const text = result.text.trim();
          if (text) {
            onTranscribed(text);
            deleteRecordingFile(recording.uri);
          } else {
            onRecordingDraft(attachment);
            onError(m.voiceNoSpeechDetected);
          }
        } catch (error) {
          console.warn('[VoiceRecording] Transcription failed', error);
          if (generation !== generationRef.current) {
            deleteRecordingFile(recording.uri);
            return;
          }
          onRecordingDraft(attachment);
          onError(m.voiceTranscribeFailed);
        }
      } else {
        await onRecorded(attachment);
      }
    } catch (error) {
      console.warn('[VoiceRecording] Capture failed', error);
      if (generation === generationRef.current) onError(m.voiceRecordingFailed);
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
        setStage('idle');
      }
    }
  }, [m.voiceNoSpeechDetected, m.voiceRecordingFailed, m.voiceTooShort, m.voiceTranscribeFailed, onError, onRecorded, onRecordingDraft, onTranscribed, transcribe]);
  finishRef.current = () => { void finish(); };

  const start = useCallback(async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    heldRef.current = true;
    destinationRef.current = 'send';
    const generation = generationRef.current;
    setDestination('send');
    setSamples([]);
    setDurationMillis(0);
    setStage('starting');
    try {
      const permission = await requestMicPermission();
      if (generation !== generationRef.current || !heldRef.current) return;
      if (!permission.granted) {
        onError(permission.canAskAgain ? m.voicePermissionDenied : m.voicePermissionSettings);
        return;
      }
      const recorder = await beginRecording((metering, duration) => {
        if (generation !== generationRef.current) return;
        setSamples(previous => [...previous.slice(-27), meteringToLevel(metering)]);
        setDurationMillis(duration);
        if (duration >= MAX_VOICE_RECORDING_MS) finishRef.current();
      });
      if (generation !== generationRef.current || !heldRef.current) {
        await discardRecording(recorder);
        return;
      }
      recorderRef.current = recorder;
      setStage('recording');
      hapticVoiceStart();
    } catch (error) {
      console.warn('[VoiceRecording] Start failed', error);
      if (generation === generationRef.current) onError(m.voiceRecordingStartFailed);
    } finally {
      if (generation === generationRef.current && !recorderRef.current) {
        busyRef.current = false;
        setStage('idle');
      }
    }
  }, [disabled, m.voicePermissionDenied, m.voicePermissionSettings, m.voiceRecordingStartFailed, onError]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled && !busyRef.current,
    onPanResponderGrant: () => { void start(); },
    onPanResponderMove: (_, gesture) => {
      const next = resolveVoiceRecordingDestination(gesture.dx, gesture.dy, destinationRef.current);
      if (next !== destinationRef.current) hapticVoiceZoneChange();
      destinationRef.current = next;
      setDestination(next);
    },
    onPanResponderRelease: () => finishRef.current(),
    onPanResponderTerminate: () => {
      destinationRef.current = 'cancel';
      finishRef.current();
    },
    onPanResponderTerminationRequest: () => false,
  }), [disabled, start]);

  return { stage, destination, samples, durationMillis, panHandlers: responder.panHandlers };
}
