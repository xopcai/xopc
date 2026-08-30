import { useCallback, useEffect, useRef, useState } from 'react';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import {
  fetchVoiceReadiness,
  transcribeVoiceBlob,
  type VoiceReadiness,
} from '@/features/chat/composer/voice-transcribe-api';
import type { ChatMessages } from '@/i18n/messages';

import { PcmWavRecorder } from './pcm-wav-recorder';

export type VoiceInputPhase = 'idle' | 'preparing' | 'requesting' | 'starting' | 'recording' | 'transcribing' | 'error';

const MAX_RECORDING_MS = 120_000;
const READINESS_POLL_MS = 1_000;

function formatElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isCaptureStartingOrRecording(phase: VoiceInputPhase): boolean {
  return phase === 'requesting' || phase === 'starting' || phase === 'recording';
}

function isCapturePending(phase: VoiceInputPhase): boolean {
  return phase === 'requesting' || phase === 'starting';
}

async function getMicrophonePermissionState(): Promise<PermissionState | null> {
  if (!navigator.permissions?.query) return null;
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return null;
  }
}

export interface UseComposerVoiceInputOptions {
  disabled: boolean;
  chat: ChatMessages;
  onTranscript: (text: string) => void;
}

export interface UseComposerVoiceInputReturn {
  phase: VoiceInputPhase;
  voiceActive: boolean;
  elapsedLabel: string;
  audioLevel: number;
  readiness: VoiceReadiness;
  hasRetainedRecording: boolean;
  startVoiceInput: () => Promise<void>;
  cancelVoiceInput: () => void;
  confirmVoiceInput: () => void;
  retryVoiceInput: () => void;
}

export function useComposerVoiceInput(options: UseComposerVoiceInputOptions): UseComposerVoiceInputReturn {
  const { disabled, chat: m, onTranscript } = options;
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [readiness, setReadiness] = useState<VoiceReadiness>({ state: 'unavailable' });
  const [hasRetainedRecording, setHasRetainedRecording] = useState(false);

  const phaseRef = useRef<VoiceInputPhase>('idle');
  const recorderRef = useRef<PcmWavRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastRecordingRef = useRef<Blob | null>(null);
  const pendingCaptureRef = useRef(false);
  const recordStartPerfRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoConfirmRef = useRef<() => void>(() => {});
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const updatePhase = useCallback((next: VoiceInputPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current != null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const stopVoiceMediaStreamTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const resetCaptureState = useCallback(() => {
    stopTimer();
    stopVoiceMediaStreamTracks();
    recorderRef.current = null;
    recordStartPerfRef.current = null;
    setElapsedSec(0);
    setAudioLevel(0);
  }, [stopTimer, stopVoiceMediaStreamTracks]);

  const finishIdle = useCallback(() => {
    resetCaptureState();
    pendingCaptureRef.current = false;
    lastRecordingRef.current = null;
    setHasRetainedRecording(false);
    updatePhase('idle');
  }, [resetCaptureState, updatePhase]);

  const cancelVoiceInput = useCallback(() => {
    recorderRef.current?.cancel();
    finishIdle();
  }, [finishIdle]);

  const processRecording = useCallback(async (blob: Blob) => {
    lastRecordingRef.current = blob;
    setHasRetainedRecording(true);
    updatePhase('transcribing');
    if (blob.size < 32) {
      showComposerNotification('warning', m.voiceTranscribeEmpty);
      finishIdle();
      return;
    }
    try {
      const payload = await transcribeVoiceBlob(blob, 'audio/wav');
      const text = (payload.refined ?? payload.raw).trim();
      if (!text) {
        showComposerNotification('warning', m.voiceTranscribeEmpty);
        finishIdle();
        return;
      }
      onTranscriptRef.current(text);
      finishIdle();
    } catch (err) {
      resetCaptureState();
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('STT is not configured') || msg.includes('503')) {
        showComposerNotification('error', m.voiceSttNotConfigured, undefined, { href: '/settings/voice' });
      } else {
        showComposerNotification('error', m.voiceTranscribeFailed);
      }
      updatePhase('error');
    }
  }, [finishIdle, m.voiceSttNotConfigured, m.voiceTranscribeEmpty, m.voiceTranscribeFailed, resetCaptureState, updatePhase]);

  const confirmVoiceInput = useCallback(() => {
    if (phaseRef.current !== 'recording') return;
    updatePhase('transcribing');
    stopTimer();
    stopVoiceMediaStreamTracks();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) {
      finishIdle();
      return;
    }
    void recorder.stop().then(processRecording).catch(() => {
      resetCaptureState();
      showComposerNotification('error', m.voiceTranscribeFailed);
      updatePhase('error');
    });
  }, [finishIdle, m.voiceTranscribeFailed, processRecording, resetCaptureState, stopTimer, stopVoiceMediaStreamTracks, updatePhase]);
  autoConfirmRef.current = confirmVoiceInput;

  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = setInterval(() => {
      const startedAt = recordStartPerfRef.current;
      if (typeof startedAt !== 'number') return;
      const elapsedMs = performance.now() - startedAt;
      setElapsedSec(Math.max(0, elapsedMs / 1000));
      if (elapsedMs >= MAX_RECORDING_MS) autoConfirmRef.current();
    }, 200);
  }, [stopTimer]);

  const beginCapture = useCallback(async () => {
    if (disabled || isCaptureStartingOrRecording(phaseRef.current)) return;
    // Consume the queued capture before changing phase. Otherwise the readiness effect
    // observes `requesting` with the queue still set and starts another permission request.
    pendingCaptureRef.current = false;
    updatePhase('starting');
    try {
      const electronSystem = window.electronAPI?.system;
      const permissionState = await getMicrophonePermissionState();
      if (!isCapturePending(phaseRef.current)) return;
      if (electronSystem && permissionState !== 'granted') {
        updatePhase('requesting');
        const permission = await electronSystem.requestMicrophone();
        const requiresMacosReauthorization =
          window.electronAPI?.platform === 'darwin' && permission.status !== 'granted';
        if (permission.status === 'denied' || requiresMacosReauthorization) {
          throw new Error('Microphone permission denied');
        }
        if (!isCapturePending(phaseRef.current)) return;
      } else if (!electronSystem && permissionState !== 'granted') {
        updatePhase('requesting');
      }
      if (!isCapturePending(phaseRef.current)) return;
      updatePhase('starting');
      window.dispatchEvent(new Event('xopc-voice-recording-start'));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!isCapturePending(phaseRef.current)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const startedAt = performance.now();
      recordStartPerfRef.current = startedAt;
      const recorder = await PcmWavRecorder.start(stream, {
        onAudioLevel: ({ level }) => {
          setAudioLevel(Math.min(1, level * 8));
        },
      });
      if (!isCapturePending(phaseRef.current)) {
        recorder.cancel();
        stopVoiceMediaStreamTracks();
        return;
      }
      recorderRef.current = recorder;
      lastRecordingRef.current = null;
      setHasRetainedRecording(false);
      setElapsedSec(0);
      updatePhase('recording');
      startTimer();
    } catch {
      const shouldReportFailure = isCapturePending(phaseRef.current);
      pendingCaptureRef.current = false;
      resetCaptureState();
      updatePhase('idle');
      if (shouldReportFailure) showComposerNotification('error', m.voiceMicDenied);
    }
  }, [disabled, m.voiceMicDenied, resetCaptureState, startTimer, stopVoiceMediaStreamTracks, updatePhase]);

  const waitForLocalPreparation = useCallback((current: VoiceReadiness) => {
    if (current.state !== 'preparing') {
      pendingCaptureRef.current = false;
      updatePhase('idle');
      showComposerNotification('error', m.voicePreparationFailed, undefined, { href: '/settings/capabilities/voice' });
      return;
    }
    pendingCaptureRef.current = true;
    updatePhase('preparing');
  }, [m.voicePreparationFailed, updatePhase]);

  const startVoiceInput = useCallback(async () => {
    if (disabled || phaseRef.current !== 'idle') return;
    const current = await fetchVoiceReadiness();
    setReadiness(current);
    if (current.state === 'ready') {
      await beginCapture();
      return;
    }
    if (current.provider === 'xopc-local' && current.state === 'preparing') {
      waitForLocalPreparation(current);
      return;
    }
    if (current.provider === 'xopc-local' && ['needs_download', 'error'].includes(current.state)) {
      showComposerNotification('error', m.voicePreparationFailed, undefined, { href: '/settings/capabilities/voice' });
      return;
    }
    showComposerNotification('error', m.voiceSttNotConfigured, undefined, { href: '/settings/voice' });
  }, [beginCapture, disabled, m.voicePreparationFailed, m.voiceSttNotConfigured, waitForLocalPreparation]);

  const retryVoiceInput = useCallback(() => {
    const blob = lastRecordingRef.current;
    if (blob) {
      void processRecording(blob);
      return;
    }
    waitForLocalPreparation(readiness);
  }, [processRecording, readiness, waitForLocalPreparation]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const current = await fetchVoiceReadiness();
      if (cancelled) return;
      setReadiness(current);
      if (pendingCaptureRef.current && current.state === 'ready') {
        await beginCapture();
      } else if (pendingCaptureRef.current && current.state === 'error') {
        updatePhase('error');
      }
    };
    void refresh();
    const interval = phase === 'preparing' ? setInterval(() => void refresh(), READINESS_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [beginCapture, phase, updatePhase]);

  useEffect(() => () => {
    recorderRef.current?.cancel();
    stopVoiceMediaStreamTracks();
    stopTimer();
  }, [stopTimer, stopVoiceMediaStreamTracks]);

  return {
    phase,
    voiceActive: phase !== 'idle',
    elapsedLabel: formatElapsed(elapsedSec),
    audioLevel,
    readiness,
    hasRetainedRecording,
    startVoiceInput,
    cancelVoiceInput,
    confirmVoiceInput,
    retryVoiceInput,
  };
}
