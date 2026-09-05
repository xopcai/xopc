import { useCallback, useEffect, useRef, useState } from 'react';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { VoiceSessionClient } from '@/features/voice/realtime/voice-session-client';
import { PcmPlayer } from '@/features/voice/realtime/pcm-player';
import type { ChatMessages } from '@/i18n/messages';

import { PcmFrameCapture, PcmStreamEncoder } from './pcm-wav-recorder';

export type VoiceInputPhase = 'idle' | 'requesting' | 'starting' | 'recording' | 'transcribing' | 'error';
type VoiceCaptureStartStage = 'permission' | 'media' | 'session' | 'recorder';
type VoiceCaptureFailureKind = 'permission' | 'device' | 'session' | 'recorder';

export type VoiceSessionMode = 'dictation' | 'conversation';
export type VoiceResponsePhase = 'idle' | 'thinking' | 'speaking';

function formatElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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

function errorName(error: unknown): string {
  return error instanceof DOMException || error instanceof Error ? error.name : '';
}

export function classifyVoiceCaptureFailure(
  stage: VoiceCaptureStartStage,
  error: unknown,
): VoiceCaptureFailureKind {
  if (stage === 'permission') return 'permission';
  if (stage === 'recorder') return 'recorder';
  if (stage === 'session') return 'session';
  const name = errorName(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  return 'device';
}

export interface UseComposerVoiceInputOptions {
  disabled: boolean;
  chat: ChatMessages;
  onTranscript: (text: string) => void;
  sessionKey?: string | null;
}

export interface UseComposerVoiceInputReturn {
  phase: VoiceInputPhase;
  voiceActive: boolean;
  elapsedLabel: string;
  audioLevel: number;
  partialTranscript: string;
  finalTranscript: string;
  responseText: string;
  responsePhase: VoiceResponsePhase;
  muted: boolean;
  mode: VoiceSessionMode;
  startVoiceInput: () => Promise<void>;
  startVoiceConversation: () => Promise<void>;
  interruptResponse: () => void;
  toggleMute: () => void;
  cancelVoiceInput: () => void;
  confirmVoiceInput: () => void;
  retryVoiceInput: () => void;
}

export function useComposerVoiceInput(options: UseComposerVoiceInputOptions): UseComposerVoiceInputReturn {
  const { disabled, chat: m, onTranscript, sessionKey } = options;
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [responseText, setResponseText] = useState('');
  const [responsePhase, setResponsePhase] = useState<VoiceResponsePhase>('idle');
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState<VoiceSessionMode>('dictation');

  const phaseRef = useRef<VoiceInputPhase>('idle');
  const captureRef = useRef<PcmFrameCapture | null>(null);
  const encoderRef = useRef<PcmStreamEncoder | null>(null);
  const clientRef = useRef<VoiceSessionClient | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordStartPerfRef = useRef<number | null>(null);
  const receivedFinalRef = useRef(false);
  const transcriptRevisionsRef = useRef(new Map<string, number>());
  const activeResponseIdRef = useRef<string | null>(null);
  const responseDoneRef = useRef(false);
  const playedBytesRef = useRef(0);
  const maxSessionMsRef = useRef(600_000);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const stopMedia = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stopTimer();
    stopMedia();
    captureRef.current?.cancel();
    captureRef.current = null;
    encoderRef.current = null;
    clientRef.current = null;
    const player = playerRef.current;
    playerRef.current = null;
    void player?.close();
    recordStartPerfRef.current = null;
    setElapsedSec(0);
    setAudioLevel(0);
    setPartialTranscript('');
    setFinalTranscript('');
    setResponseText('');
    setResponsePhase('idle');
    setMuted(false);
    transcriptRevisionsRef.current.clear();
    activeResponseIdRef.current = null;
  }, [stopMedia, stopTimer]);

  const finishIdle = useCallback(() => {
    reset();
    updatePhase('idle');
  }, [reset, updatePhase]);

  const cancelVoiceInput = useCallback(() => {
    clientRef.current?.stop('user_finished');
    finishIdle();
  }, [finishIdle]);

  const handleSessionClose = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'idle' || current === 'error') return;
    if (current === 'transcribing' && !receivedFinalRef.current) {
      showComposerNotification('warning', m.voiceTranscribeEmpty);
    } else if (current === 'recording') {
      showComposerNotification('error', m.voiceTranscribeFailed);
    }
    finishIdle();
  }, [finishIdle, m.voiceTranscribeEmpty, m.voiceTranscribeFailed]);

  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = setInterval(() => {
      const startedAt = recordStartPerfRef.current;
      if (startedAt === null) return;
      const elapsedMs = performance.now() - startedAt;
      setElapsedSec(Math.max(0, elapsedMs / 1_000));
      if (elapsedMs >= maxSessionMsRef.current && phaseRef.current === 'recording') {
        clientRef.current?.stop('user_finished');
        finishIdle();
      }
    }, 200);
  }, [finishIdle, stopTimer]);

  const beginCapture = useCallback(async (purpose: VoiceSessionMode) => {
    if (disabled || phaseRef.current !== 'idle') return;
    if (purpose === 'conversation' && !sessionKey) return;
    setMode(purpose);
    setResponseText('');
    updatePhase('starting');
    let stage: VoiceCaptureStartStage = 'permission';
    try {
      if (purpose === 'conversation') {
        const player = new PcmPlayer();
        playerRef.current = player;
        await player.start();
      }
      const electronSystem = window.electronAPI?.system;
      const permissionState = await getMicrophonePermissionState();
      if (!isCapturePending(phaseRef.current)) return;
      if (electronSystem && permissionState !== 'granted') {
        updatePhase('requesting');
        const permission = await electronSystem.requestMicrophone();
        const requiresMacosReauthorization = window.electronAPI?.platform === 'darwin' && permission.status !== 'granted';
        if (permission.status === 'denied' || requiresMacosReauthorization) throw new Error('Microphone permission denied');
      } else if (!electronSystem && permissionState !== 'granted') {
        updatePhase('requesting');
      }
      if (!isCapturePending(phaseRef.current)) return;
      updatePhase('starting');
      window.dispatchEvent(new Event('xopc-voice-recording-start'));
      stage = 'media';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!isCapturePending(phaseRef.current)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      stage = 'session';
      receivedFinalRef.current = false;
      const client = await VoiceSessionClient.connect({
        purpose,
        ...(sessionKey ? { sessionKey } : {}),
        onEvent: (event) => {
          if (event.type === 'input.transcript.delta' || event.type === 'input.transcript.final') {
            const previous = transcriptRevisionsRef.current.get(event.payload.utteranceId) ?? 0;
            if (event.payload.revision <= previous) return;
            if (transcriptRevisionsRef.current.size >= 256) transcriptRevisionsRef.current.clear();
            transcriptRevisionsRef.current.set(event.payload.utteranceId, event.payload.revision);
          }
          if (event.type === 'input.transcript.delta') setPartialTranscript(event.payload.text);
          if (event.type === 'input.transcript.final') {
            const text = event.payload.text.trim();
            setPartialTranscript('');
            setFinalTranscript(text);
            if (text && purpose === 'dictation') {
              receivedFinalRef.current = true;
              onTranscriptRef.current(text);
            }
          }
          if (event.type === 'input.speech_stopped') playerRef.current?.duck(false);
          if (event.type === 'response.created') {
            playerRef.current?.clear();
            activeResponseIdRef.current = event.payload.responseId;
            responseDoneRef.current = false;
            playedBytesRef.current = 0;
            setResponseText('');
            setResponsePhase('thinking');
          }
          if (event.type === 'response.text.delta') {
            setResponseText((current) => current + event.payload.delta);
          }
          if (event.type === 'response.audio.started' && activeResponseIdRef.current === event.payload.responseId) {
            setResponsePhase('speaking');
          }
          if (event.type === 'response.done' && activeResponseIdRef.current === event.payload.responseId) {
            responseDoneRef.current = true;
            if (!playerRef.current?.hasPendingAudio) {
              activeResponseIdRef.current = null;
              setResponsePhase('idle');
            }
          }
          if (event.type === 'response.cancelled' && activeResponseIdRef.current === event.payload.responseId) {
            activeResponseIdRef.current = null;
            setResponsePhase('idle');
            playerRef.current?.clear();
          }
          if (event.type === 'session.error' && event.payload.recoverable && event.payload.code === 'RESPONSE_FAILED') {
            showComposerNotification('warning', m.voiceResponseFailed);
          }
          if (event.type === 'session.error' && !event.payload.recoverable) {
            showComposerNotification('error', m.voiceTranscribeFailed);
            clientRef.current?.stop('surface_closed');
            reset();
            updatePhase('error');
          }
        },
        onAudio: (audio) => {
          const responseId = activeResponseIdRef.current;
          if (!responseId) return;
          playerRef.current?.enqueue(audio, () => {
            if (activeResponseIdRef.current !== responseId) return;
            playedBytesRef.current += audio.byteLength;
            clientRef.current?.acknowledgeAudio(responseId, playedBytesRef.current);
            if (responseDoneRef.current && !playerRef.current?.hasPendingAudio) {
              activeResponseIdRef.current = null;
              setResponsePhase('idle');
            }
          });
        },
        onClose: handleSessionClose,
      });
      clientRef.current = client;
      maxSessionMsRef.current = client.session.limits.maxSessionMs;
      stage = 'recorder';
      let encoder: PcmStreamEncoder | undefined;
      const pendingSamples: Float32Array[] = [];
      const capture = await PcmFrameCapture.start(stream, {
        onSamples: (samples) => {
          if (!encoder) {
            pendingSamples.push(samples);
            return;
          }
          const encoded = encoder?.push(samples);
          if (encoded) client.sendAudio(encoded);
        },
        onAudioLevel: ({ level, speaking }) => {
          setAudioLevel(Math.min(1, level * 8));
          if (purpose === 'conversation' && client.session.bargeIn && activeResponseIdRef.current) {
            playerRef.current?.duck(speaking);
          }
        },
      });
      encoder = new PcmStreamEncoder(capture.sampleRate, client.session.inputFormat.sampleRate);
      for (const samples of pendingSamples) client.sendAudio(encoder.push(samples));
      if (!isCapturePending(phaseRef.current)) {
        capture.cancel();
        client.stop('surface_closed');
        stopMedia();
        return;
      }
      encoderRef.current = encoder;
      captureRef.current = capture;
      recordStartPerfRef.current = performance.now();
      setElapsedSec(0);
      updatePhase('recording');
      startTimer();
    } catch (error) {
      const failureKind = classifyVoiceCaptureFailure(stage, error);
      console.error('[chat:voice] realtime capture start failed', {
        stage,
        kind: failureKind,
        errorName: errorName(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      clientRef.current?.stop('surface_closed');
      reset();
      updatePhase(failureKind === 'session' ? 'error' : 'idle');
      const message = failureKind === 'permission'
        ? m.voiceMicDenied
        : failureKind === 'device'
          ? m.voiceMicUnavailable
          : failureKind === 'recorder'
            ? m.voiceRecorderFailed
            : m.voiceSttNotConfigured;
      showComposerNotification('error', message, undefined, failureKind === 'session' ? { href: '/settings/capabilities/voice' } : undefined);
    }
  }, [disabled, handleSessionClose, m, reset, sessionKey, startTimer, stopMedia, updatePhase]);

  const confirmVoiceInput = useCallback(() => {
    if (phaseRef.current !== 'recording') return;
    updatePhase('transcribing');
    stopTimer();
    stopMedia();
    const capture = captureRef.current;
    captureRef.current = null;
    void capture?.stop().then(() => {
      const finalAudio = encoderRef.current?.flush();
      if (finalAudio) clientRef.current?.sendAudio(finalAudio);
      clientRef.current?.commit();
    }).catch(() => {
      showComposerNotification('error', m.voiceTranscribeFailed);
      clientRef.current?.stop('surface_closed');
      reset();
      updatePhase('error');
    });
  }, [m.voiceTranscribeFailed, reset, stopMedia, stopTimer, updatePhase]);

  useEffect(() => () => {
    captureRef.current?.cancel();
    clientRef.current?.stop('surface_closed');
    void playerRef.current?.close();
    stopMedia();
    stopTimer();
  }, [stopMedia, stopTimer]);

  const retryVoiceInput = useCallback(() => {
    if (phaseRef.current !== 'error') return;
    updatePhase('idle');
    void beginCapture(mode);
  }, [beginCapture, mode, updatePhase]);

  const startVoiceInput = useCallback(() => beginCapture('dictation'), [beginCapture]);
  const startVoiceConversation = useCallback(() => beginCapture('conversation'), [beginCapture]);
  const interruptResponse = useCallback(() => {
    const responseId = activeResponseIdRef.current;
    playerRef.current?.clear();
    activeResponseIdRef.current = null;
    setResponsePhase('idle');
    if (responseId) clientRef.current?.cancelResponse(responseId);
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      playerRef.current?.setMuted(next);
      return next;
    });
  }, []);

  return {
    phase,
    voiceActive: phase !== 'idle',
    elapsedLabel: formatElapsed(elapsedSec),
    audioLevel,
    partialTranscript,
    finalTranscript,
    responseText,
    responsePhase,
    muted,
    mode,
    startVoiceInput,
    startVoiceConversation,
    interruptResponse,
    toggleMute,
    cancelVoiceInput,
    confirmVoiceInput,
    retryVoiceInput,
  };
}
