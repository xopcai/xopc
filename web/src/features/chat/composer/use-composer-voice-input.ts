import { useCallback, useEffect, useRef, useState } from 'react';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import {
  fetchVoiceSttAvailable,
  transcribeVoiceBlob,
} from '@/features/chat/composer/voice-transcribe-api';
import type { ChatMessages } from '@/i18n/messages';

export type VoiceInputPhase = 'idle' | 'recording' | 'transcribing';

function formatElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface UseComposerVoiceInputOptions {
  /** Same gate as text input (session loading, clarify, etc.) — not blocked while agent streams. */
  disabled: boolean;
  chat: ChatMessages;
  onTranscript: (text: string) => void;
}

export interface UseComposerVoiceInputReturn {
  phase: VoiceInputPhase;
  voiceActive: boolean;
  elapsedLabel: string;
  startVoiceInput: () => Promise<void>;
  cancelVoiceInput: () => void;
  confirmVoiceInput: () => void;
}

export function useComposerVoiceInput(options: UseComposerVoiceInputOptions): UseComposerVoiceInputReturn {
  const { disabled, chat: m, onTranscript } = options;

  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderMimeRef = useRef('');
  const skipProcessRef = useRef(false);
  const pendingConfirmRef = useRef(false);
  const recordStartPerfRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current != null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const stopVoiceMediaStreamTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  const finishIdle = useCallback(() => {
    stopTimer();
    stopVoiceMediaStreamTracks();
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
    recordStartPerfRef.current = null;
    pendingConfirmRef.current = false;
    skipProcessRef.current = false;
    setElapsedSec(0);
    setPhase('idle');
  }, [stopTimer, stopVoiceMediaStreamTracks]);

  const stopRecorder = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      finishIdle();
    }
    mediaRecorderRef.current = null;
  }, [finishIdle]);

  const cancelVoiceInput = useCallback(() => {
    skipProcessRef.current = true;
    pendingConfirmRef.current = false;
    stopRecorder();
  }, [stopRecorder]);

  const processRecording = useCallback(
    async (chunks: Blob[], mimeType: string) => {
      setPhase('transcribing');
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      if (blob.size < 32) {
        showComposerNotification('warning', m.voiceTranscribeEmpty);
        finishIdle();
        return;
      }

      try {
        const payload = await transcribeVoiceBlob(blob, blob.type || mimeType || 'audio/webm');
        const text = (payload.refined ?? payload.raw).trim();
        if (!text) {
          showComposerNotification('warning', m.voiceTranscribeEmpty);
          finishIdle();
          return;
        }
        onTranscriptRef.current(text);
        finishIdle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('STT is not configured') || msg.includes('503')) {
          showComposerNotification('error', m.voiceSttNotConfigured, undefined, { href: '/settings/voice' });
        } else {
          showComposerNotification('error', m.voiceTranscribeFailed);
        }
        finishIdle();
      }
    },
    [finishIdle, m.voiceSttNotConfigured, m.voiceTranscribeEmpty, m.voiceTranscribeFailed],
  );

  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = setInterval(() => {
      const t0 = recordStartPerfRef.current;
      if (typeof t0 === 'number') {
        setElapsedSec(Math.max(0, (performance.now() - t0) / 1000));
      }
    }, 200);
  }, [stopTimer]);

  const startVoiceInput = useCallback(async () => {
    if (disabled || phase !== 'idle') return;

    const sttOk = await fetchVoiceSttAvailable();
    if (!sttOk) {
      showComposerNotification('error', m.voiceSttNotConfigured, undefined, { href: '/settings/voice' });
      return;
    }

    skipProcessRef.current = false;
    pendingConfirmRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      recorderMimeRef.current = mimeType;
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      mediaChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        void (async () => {
          try {
            const chunks = mediaChunksRef.current;
            mediaChunksRef.current = [];
            const mime = recorderMimeRef.current || rec.mimeType;

            if (skipProcessRef.current) {
              finishIdle();
              return;
            }

            if (pendingConfirmRef.current) {
              pendingConfirmRef.current = false;
              await processRecording(chunks, mime);
              return;
            }

            finishIdle();
          } finally {
            stopVoiceMediaStreamTracks();
          }
        })();
      };

      mediaRecorderRef.current = rec;
      recordStartPerfRef.current = performance.now();
      setElapsedSec(0);
      rec.start(250);
      setPhase('recording');
      startTimer();
    } catch {
      finishIdle();
      showComposerNotification('error', m.voiceMicDenied);
    }
  }, [
    disabled,
    finishIdle,
    m.voiceMicDenied,
    m.voiceSttNotConfigured,
    phase,
    processRecording,
    startTimer,
    stopVoiceMediaStreamTracks,
  ]);

  const confirmVoiceInput = useCallback(() => {
    if (phase !== 'recording') return;
    pendingConfirmRef.current = true;
    skipProcessRef.current = false;
    setPhase('transcribing');
    stopTimer();
    stopRecorder();
  }, [phase, stopRecorder, stopTimer]);

  useEffect(() => {
    return () => {
      skipProcessRef.current = true;
      pendingConfirmRef.current = false;
      stopRecorder();
    };
  }, [stopRecorder]);

  return {
    phase,
    voiceActive: phase !== 'idle',
    elapsedLabel: formatElapsed(elapsedSec),
    startVoiceInput,
    cancelVoiceInput,
    confirmVoiceInput,
  };
}
