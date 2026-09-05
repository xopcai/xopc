import { useCallback, useEffect, useRef, useState } from 'react';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { VoiceSessionClient } from '@/features/voice/realtime/voice-session-client';
import { PcmPlayer } from '@/features/voice/realtime/pcm-player';
import { voiceInputConstraints } from '@/stores/voice-preferences-store';
import { apiUrl } from '@/lib/url';
import { fetchJson } from '@/lib/fetch';
import type { ChatMessages } from '@/i18n/messages';

import { PcmFrameCapture, PcmStreamEncoder } from '@/features/chat/composer/pcm-wav-recorder';

let captureOwner: symbol | null = null;

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

export interface UseRealtimeVoiceOptions {
  disabled: boolean;
  chat: ChatMessages;
  onTranscript: (text: string) => void;
}

export interface UseRealtimeVoiceReturn {
  phase: VoiceInputPhase;
  voiceActive: boolean;
  elapsedLabel: string;
  audioLevel: number;
  partialTranscript: string;
  finalTranscript: string;
  responseText: string;
  activities: Array<{ toolCallId: string; toolName: string; status: 'running' | 'completed' | 'failed' }>;
  clarification: { responseId: string; requestId: string; question: string; choices?: string[] } | null;
  dismissClarification: (requestId: string) => void;
  responsePhase: VoiceResponsePhase;
  muted: boolean;
  error: string | null;
  failureKind: VoiceCaptureFailureKind | null;
  endedReason: string | null;
  mode: VoiceSessionMode;
  startVoiceInput: () => Promise<void>;
  startVoiceConversation: (sessionKey: string, engine?: 'agent' | 'omni') => Promise<void>;
  interruptResponse: () => void;
  toggleMute: () => void;
  cancelVoiceInput: () => void;
  confirmVoiceInput: () => void;
  retryVoiceInput: () => void;
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  const { disabled, chat: m, onTranscript } = options;
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [responseText, setResponseText] = useState('');
  const [activities, setActivities] = useState<UseRealtimeVoiceReturn['activities']>([]);
  const [clarification, setClarification] = useState<UseRealtimeVoiceReturn['clarification']>(null);
  const [responsePhase, setResponsePhase] = useState<VoiceResponsePhase>('idle');
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<VoiceCaptureFailureKind | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const callSessionKeyRef = useRef<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<VoiceSessionMode>('dictation');

  const ownerRef = useRef(Symbol('voice-capture'));
  const phaseRef = useRef<VoiceInputPhase>('idle');
  const attemptRef = useRef(0);
  const captureRef = useRef<PcmFrameCapture | null>(null);
  const encoderRef = useRef<PcmStreamEncoder | null>(null);
  const clientRef = useRef<VoiceSessionClient | null>(null);
  const engineRef = useRef<'agent' | 'omni' | undefined>(undefined);
  const playerRef = useRef<PcmPlayer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordStartPerfRef = useRef<number | null>(null);
  const dictationRef = useRef(new Map<string, string>());
  const finalizingRef = useRef(false);
  const confirmRef = useRef<() => void>(() => {});
  const transcriptRevisionsRef = useRef(new Map<string, number>());
  const activeResponseIdRef = useRef<string | null>(null);
  const responseDoneRef = useRef(false);
  const speechStoppedAtRef = useRef<number | null>(null);
  const firstAudioRef = useRef(false);
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
    if (captureOwner === ownerRef.current) captureOwner = null;
    attemptRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
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
    setActivities([]);
    setClarification(null);
    speechStoppedAtRef.current = null;
    mutedRef.current = false;
    setMuted(false);
    transcriptRevisionsRef.current.clear();
    dictationRef.current.clear();
    finalizingRef.current = false;
    activeResponseIdRef.current = null;
  }, [stopMedia, stopTimer]);

  const finishIdle = useCallback(() => {
    reset();
    updatePhase('idle');
  }, [reset, updatePhase]);

  const cancelVoiceInput = useCallback(() => {
    clientRef.current?.stop('user_finished');
    finishIdle();
    setError(null);
    setFailureKind(null);
    setEndedReason(null);
  }, [finishIdle]);

  const finishDictation = useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const attempt = attemptRef.current;
    const text = [...dictationRef.current.values()].join(' ').trim();
    stopMedia();
    stopTimer();
    captureRef.current?.cancel();
    captureRef.current = null;
    updatePhase('transcribing');
    if (!text) { showComposerNotification('warning', m.voiceTranscribeEmpty); finishIdle(); return; }
    let result = text;
    try {
      const refined = await fetchJson<{ payload: { text: string } }>(apiUrl('/api/voice/transcriptions/refine'), {
        method: 'POST', body: JSON.stringify({ text }),
        signal: AbortSignal.any([controllerRef.current!.signal, AbortSignal.timeout(15_000)]),
      });
      if (refined.payload.text.trim()) result = refined.payload.text;
    } catch {
      if (attempt !== attemptRef.current) return;
      showComposerNotification('warning', m.voiceRefinementFailed);
    }
    if (attempt !== attemptRef.current) return;
    onTranscriptRef.current(result);
    finishIdle();
  }, [finishIdle, m.voiceRefinementFailed, m.voiceTranscribeEmpty, stopMedia, stopTimer, updatePhase]);

  const handleSessionClose = useCallback((reason: string) => {
    setEndedReason(reason);
    const current = phaseRef.current;
    if (current === 'idle' || current === 'error' || finalizingRef.current) return;
    if (!callSessionKeyRef.current) {
      if (current === 'transcribing' && reason === 'input_committed') { void finishDictation(); return; }
      // Keep recognized text recoverable until the user chooses Finish or Cancel.
      stopTimer(); stopMedia(); captureRef.current?.cancel(); captureRef.current = null; clientRef.current = null;
      setError(m.voiceTranscribeFailed);
      updatePhase('error');
      return;
    }
    finishIdle();
  }, [finishDictation, finishIdle, m.voiceTranscribeFailed, stopMedia, stopTimer, updatePhase]);

  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = setInterval(() => {
      const startedAt = recordStartPerfRef.current;
      if (startedAt === null) return;
      const elapsedMs = performance.now() - startedAt;
      setElapsedSec(Math.max(0, elapsedMs / 1_000));
      if (elapsedMs >= maxSessionMsRef.current && phaseRef.current === 'recording') {
        if (!callSessionKeyRef.current) { confirmRef.current(); return; }
        setEndedReason('session_limit');
        clientRef.current?.stop('user_finished');
        finishIdle();
      }
    }, 200);
  }, [finishIdle, stopTimer]);

  const beginCapture = useCallback(async (purpose: VoiceSessionMode, engine?: 'agent' | 'omni', conversationKey?: string) => {
    if (disabled || phaseRef.current !== 'idle') return;
    if (purpose === 'conversation' && !conversationKey) return;
    if (captureOwner) {
      setError(m.callCaptureBusy);
      if (purpose === 'dictation') showComposerNotification('error', m.callCaptureBusy);
      return;
    }
    captureOwner = ownerRef.current;
    callSessionKeyRef.current = conversationKey;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setFailureKind(null);
    setEndedReason(null);
    const attempt = ++attemptRef.current;
    const isCurrent = () => attempt === attemptRef.current;
    setMode(purpose);
    engineRef.current = engine;
    setResponseText('');
    updatePhase('starting');
    let stage: VoiceCaptureStartStage = 'permission';
    try {
      if (purpose === 'conversation') {
        const player = new PcmPlayer();
        playerRef.current = player;
        await player.start();
        if (!isCurrent()) { void player.close(); return; }
      }
      stage = 'session';
      await VoiceSessionClient.preflight({ purpose, ...(purpose === 'conversation' ? { engine, sessionKey: conversationKey } : {}), signal: controller.signal });
      if (!isCurrent()) return;
      stage = 'permission';
      const electronSystem = window.electronAPI?.system;
      const permissionState = await getMicrophonePermissionState();
      if (!isCurrent() || !isCapturePending(phaseRef.current)) return;
      if (electronSystem && permissionState !== 'granted') {
        updatePhase('requesting');
        const permission = await electronSystem.requestMicrophone();
        if (!isCurrent()) return;
        const requiresMacosReauthorization = window.electronAPI?.platform === 'darwin' && permission.status !== 'granted';
        if (permission.status === 'denied' || requiresMacosReauthorization) throw new Error('Microphone permission denied');
      } else if (!electronSystem && permissionState !== 'granted') {
        updatePhase('requesting');
      }
      if (!isCurrent() || !isCapturePending(phaseRef.current)) return;
      updatePhase('starting');
      window.dispatchEvent(new Event('xopc-voice-recording-start'));
      stage = 'media';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: voiceInputConstraints(),
      });
      if (!isCurrent() || !isCapturePending(phaseRef.current)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      stage = 'session';
      dictationRef.current.clear();
      const client = await VoiceSessionClient.connect({
        purpose,
        signal: controller.signal,
        ...(purpose === 'conversation' ? { engine, sessionKey: conversationKey } : {}),
        onEvent: (event) => {
          if (!isCurrent()) return;
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
              dictationRef.current.set(event.payload.utteranceId, text);
              if ([...dictationRef.current.values()].join(' ').length >= 20_000 && phaseRef.current === 'recording') confirmRef.current();
              setFinalTranscript([...dictationRef.current.values()].join(' '));
            }
          }
          if (event.type === 'input.speech_stopped') { speechStoppedAtRef.current = performance.now(); playerRef.current?.duck(false); }
          if (event.type === 'response.created') {
            playerRef.current?.clear();
            activeResponseIdRef.current = event.payload.responseId;
            responseDoneRef.current = false;
            firstAudioRef.current = false;
            playedBytesRef.current = 0;
            setResponseText('');
            setActivities([]);
            setClarification(null);
            setResponsePhase('thinking');
          }
          if (event.type === 'response.activity' && activeResponseIdRef.current === event.payload.responseId) {
            setActivities((current) => [...current.filter((activity) => activity.toolCallId !== event.payload.toolCallId), event.payload].slice(-8));
          }
          if (event.type === 'response.clarification' && activeResponseIdRef.current === event.payload.responseId) setClarification(event.payload);
          if (event.type === 'response.text.delta' && activeResponseIdRef.current === event.payload.responseId) {
            setResponseText((current) => current + event.payload.delta);
          }
          if (event.type === 'response.audio.started' && activeResponseIdRef.current === event.payload.responseId) {
            setResponsePhase('speaking');
          }
          if (event.type === 'response.done' && activeResponseIdRef.current === event.payload.responseId) {
            setClarification(null);
            responseDoneRef.current = true;
            if (!playerRef.current?.hasPendingAudio) {
              activeResponseIdRef.current = null;
              setResponsePhase('idle');
            }
          }
          if (event.type === 'response.cancelled' && activeResponseIdRef.current === event.payload.responseId) {
            activeResponseIdRef.current = null;
            setClarification(null);
            setActivities([]);
            setResponsePhase('idle');
            playerRef.current?.clear();
          }
          if (event.type === 'session.error' && event.payload.recoverable && event.payload.code === 'RESPONSE_FAILED') {
            showComposerNotification('warning', m.voiceResponseFailed);
          }
          if (event.type === 'session.error' && event.payload.recoverable && event.payload.code === 'INPUT_DROPPED') {
            showComposerNotification('warning', m.voiceInputDropped);
          }
          if (event.type === 'session.error' && !event.payload.recoverable) {
            setError(event.payload.message);
            setFailureKind('session');
            if (purpose === 'dictation') showComposerNotification('error', event.payload.message);
            clientRef.current?.stop('surface_closed');
            if (purpose === 'conversation') reset();
            else { stopTimer(); stopMedia(); captureRef.current?.cancel(); captureRef.current = null; clientRef.current = null; }
            updatePhase('error');
          }
        },
        onAudio: (audio, frameResponseId) => {
          if (!isCurrent()) return;
          const responseId = activeResponseIdRef.current;
          if (!responseId || frameResponseId !== responseId) return;
          if (!firstAudioRef.current) {
            firstAudioRef.current = true;
            if (speechStoppedAtRef.current !== null) clientRef.current?.reportMetric(responseId, 'speech_end_to_audio_received', performance.now() - speechStoppedAtRef.current);
            speechStoppedAtRef.current = null;
          }
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
        onClose: (reason) => { if (isCurrent()) handleSessionClose(reason); },
      });
      if (!isCurrent()) { client.stop('surface_closed'); return; }
      clientRef.current = client;
      maxSessionMsRef.current = client.session.limits.maxSessionMs;
      stage = 'recorder';
      let encoder: PcmStreamEncoder | undefined;
      const pendingSamples: Float32Array[] = [];
      const capture = await PcmFrameCapture.start(stream, {
        onSamples: (samples) => {
          if (!isCurrent() || mutedRef.current) return;
          if (!encoder) {
            pendingSamples.push(samples);
            return;
          }
          const encoded = (encoderRef.current ?? encoder).push(samples);
          if (encoded) client.sendAudio(encoded);
        },
        onAudioLevel: ({ level, speaking }) => {
          if (!isCurrent()) return;
          if (mutedRef.current) return;
          setAudioLevel(Math.min(1, level * 8));
          if (purpose === 'conversation' && client.session.bargeIn && activeResponseIdRef.current) {
            playerRef.current?.duck(speaking);
          }
        },
      });
      if (!isCurrent() || !isCapturePending(phaseRef.current)) {
        capture.cancel();
        client.stop('surface_closed');
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      encoder = new PcmStreamEncoder(capture.sampleRate, client.session.inputFormat.sampleRate);
      for (const samples of pendingSamples) client.sendAudio(encoder.push(samples));
      encoderRef.current = encoder;
      captureRef.current = capture;
      recordStartPerfRef.current = performance.now();
      setElapsedSec(0);
      updatePhase('recording');
      startTimer();
    } catch (error) {
      if (!isCurrent()) return;
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
            : error instanceof Error ? error.message : m.voiceSttNotConfigured;
      setError(message);
      setFailureKind(failureKind);
      if (purpose === 'dictation') showComposerNotification('error', message, undefined, failureKind === 'session' ? { href: '/settings/capabilities/voice' } : undefined);
    }
  }, [disabled, handleSessionClose, m, reset, startTimer, stopMedia, stopTimer, updatePhase]);

  const confirmVoiceInput = useCallback(() => {
    if (callSessionKeyRef.current) return;
    if (phaseRef.current === 'error' && dictationRef.current.size) { void finishDictation(); return; }
    if (phaseRef.current !== 'recording') return;
    updatePhase('transcribing');
    stopTimer();
    stopMedia();
    const capture = captureRef.current;
    const attempt = attemptRef.current;
    captureRef.current = null;
    void capture?.stop().then(() => {
      if (attempt !== attemptRef.current) return;
      const finalAudio = encoderRef.current?.flush();
      if (finalAudio) clientRef.current?.sendAudio(finalAudio);
      clientRef.current?.commit();
    }).catch(() => {
      if (attempt !== attemptRef.current) return;
      showComposerNotification('error', m.voiceTranscribeFailed);
      clientRef.current?.stop('surface_closed');
      reset();
      updatePhase('error');
    });
  }, [finishDictation, m.voiceTranscribeFailed, reset, stopMedia, stopTimer, updatePhase]);
  confirmRef.current = confirmVoiceInput;

  useEffect(() => () => {
    if (captureOwner === ownerRef.current) captureOwner = null;
    attemptRef.current += 1;
    controllerRef.current?.abort();
    captureRef.current?.cancel();
    clientRef.current?.stop('surface_closed');
    void playerRef.current?.close();
    stopMedia();
    stopTimer();
  }, [stopMedia, stopTimer]);

  const retryVoiceInput = useCallback(() => {
    if (phaseRef.current !== 'error') return;
    reset();
    updatePhase('idle');
    void beginCapture(mode, engineRef.current, callSessionKeyRef.current);
  }, [beginCapture, mode, reset, updatePhase]);

  const startVoiceInput = useCallback(() => beginCapture('dictation'), [beginCapture]);
  const startVoiceConversation = useCallback((key: string, engine?: 'agent' | 'omni') => beginCapture('conversation', engine, key), [beginCapture]);
  const interruptResponse = useCallback(() => {
    const startedAt = performance.now();
    const responseId = activeResponseIdRef.current;
    playerRef.current?.clear();
    activeResponseIdRef.current = null;
    setResponsePhase('idle');
    setClarification(null);
    setActivities([]);
    if (responseId) {
      clientRef.current?.reportMetric(responseId, 'local_stop', performance.now() - startedAt);
      clientRef.current?.cancelResponse(responseId);
    }
  }, []);
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    mediaStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    // Discard partial frames so speech from before muting cannot leak on unmute.
    const capture = captureRef.current;
    const client = clientRef.current;
    if (capture && client) {
      encoderRef.current = new PcmStreamEncoder(capture.sampleRate, client.session.inputFormat.sampleRate);
    }
    client?.setInputMuted(next);
    setPartialTranscript('');
    setAudioLevel(0);
    playerRef.current?.duck(false);
    setMuted(next);
  }, []);

  return {
    phase,
    voiceActive: phase !== 'idle',
    elapsedLabel: formatElapsed(elapsedSec),
    audioLevel,
    partialTranscript,
    finalTranscript,
    responseText,
    activities,
    clarification,
    dismissClarification: (requestId) => setClarification((current) => current?.requestId === requestId ? null : current),
    responsePhase,
    muted,
    error,
    failureKind,
    endedReason,
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
