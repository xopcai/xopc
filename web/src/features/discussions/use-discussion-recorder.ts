import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteDiscussionDraft,
  listDiscussionDraftChunks,
  listDiscussionDrafts,
  saveDiscussionDraft,
  saveDiscussionDraftChunk,
} from './discussion-draft-store';
import type { DiscussionDraft } from './discussion-types';

const MAX_RECORDING_MS = 30 * 60 * 1_000;
const MIN_AVAILABLE_BYTES = 30 * 1024 * 1024;

export type DiscussionRecorderPhase =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return [
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export function useDiscussionRecorder() {
  const [phase, setPhase] = useState<DiscussionRecorderPhase>('idle');
  const [draft, setDraft] = useState<DiscussionDraft | null>(null);
  const [recoverableDrafts, setRecoverableDrafts] = useState<DiscussionDraft[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const draftRef = useRef<DiscussionDraft | null>(null);
  const chunkIndexRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const segmentStartedAtRef = useRef(0);
  const persistQueueRef = useRef(Promise.resolve());
  const intervalRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);

  const refreshRecoverableDrafts = useCallback(async () => {
    try {
      setRecoverableDrafts(await listDiscussionDrafts());
    } catch {
      setRecoverableDrafts([]);
    }
  }, []);

  useEffect(() => {
    void refreshRecoverableDrafts();
  }, [refreshRecoverableDrafts]);

  const stopTimersAndStream = useCallback(() => {
    if (intervalRef.current != null) window.clearInterval(intervalRef.current);
    if (maxTimerRef.current != null) window.clearTimeout(maxTimerRef.current);
    intervalRef.current = null;
    maxTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => stopTimersAndStream(), [stopTimersAndStream]);

  const persistChunk = useCallback((blob: Blob) => {
    const active = draftRef.current;
    if (!active || blob.size === 0) return;
    const index = chunkIndexRef.current++;
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      await saveDiscussionDraftChunk({ draftId: active.id, index, blob, createdAt: Date.now() });
      const current = draftRef.current;
      if (!current || current.id !== active.id) return;
      const updated = {
        ...current,
        chunkCount: Math.max(current.chunkCount, index + 1),
        durationMs: Math.max(
          current.durationMs,
          accumulatedMsRef.current + (segmentStartedAtRef.current ? Date.now() - segmentStartedAtRef.current : 0),
        ),
        updatedAt: Date.now(),
      };
      draftRef.current = updated;
      setDraft(updated);
      await saveDiscussionDraft(updated);
    });
  }, []);

  const stop = useCallback(async (): Promise<DiscussionDraft | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return draftRef.current;
    setPhase('stopping');
    if (recorder.state === 'recording' && segmentStartedAtRef.current) {
      accumulatedMsRef.current += Date.now() - segmentStartedAtRef.current;
      segmentStartedAtRef.current = 0;
    }
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
    await persistQueueRef.current;
    const current = draftRef.current;
    if (!current) {
      stopTimersAndStream();
      setPhase('error');
      setError('The recording draft could not be recovered.');
      return null;
    }
    const stopped = {
      ...current,
      state: 'stopped' as const,
      durationMs: Math.min(MAX_RECORDING_MS, Math.max(1_000, accumulatedMsRef.current)),
      updatedAt: Date.now(),
    };
    await saveDiscussionDraft(stopped);
    draftRef.current = stopped;
    setDraft(stopped);
    setElapsedMs(stopped.durationMs);
    stopTimersAndStream();
    setPhase('stopped');
    await refreshRecoverableDrafts();
    return stopped;
  }, [refreshRecoverableDrafts, stopTimersAndStream]);

  const start = useCallback(async (input: {
    projectId?: string;
    title?: string;
    language: string;
    captureMode: 'solo' | 'conversation';
    consentConfirmed: boolean;
  }) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this environment.');
      setPhase('error');
      return;
    }
    setError(null);
    setPhase('requesting_permission');
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota != null && estimate.usage != null && estimate.quota - estimate.usage < MIN_AVAILABLE_BYTES) {
        throw new Error('Not enough local storage for a discussion recording.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const selectedMimeType = pickAudioMimeType();
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
      const now = Date.now();
      const nextDraft: DiscussionDraft = {
        id: crypto.randomUUID(),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        language: input.language,
        captureMode: input.captureMode,
        consentConfirmed: input.consentConfirmed,
        mimeType: recorder.mimeType || selectedMimeType || 'audio/webm',
        startedAt: now,
        updatedAt: now,
        durationMs: 0,
        chunkCount: 0,
        state: 'recording',
      };
      await saveDiscussionDraft(nextDraft);
      recorderRef.current = recorder;
      draftRef.current = nextDraft;
      chunkIndexRef.current = 0;
      accumulatedMsRef.current = 0;
      segmentStartedAtRef.current = now;
      persistQueueRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => persistChunk(event.data);
      recorder.onerror = () => {
        setError('The microphone stopped unexpectedly. Stop and submit the saved recording.');
      };
      recorder.start(5_000);
      setDraft(nextDraft);
      setElapsedMs(0);
      setPhase('recording');
      intervalRef.current = window.setInterval(() => {
        setElapsedMs(accumulatedMsRef.current + (
          segmentStartedAtRef.current ? Date.now() - segmentStartedAtRef.current : 0
        ));
      }, 1_000);
      maxTimerRef.current = window.setTimeout(() => void stop(), MAX_RECORDING_MS);
    } catch (caught) {
      stopTimersAndStream();
      setError(caught instanceof Error ? caught.message : 'Microphone permission was denied.');
      setPhase('error');
    }
  }, [persistChunk, stop, stopTimersAndStream]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== 'recording') return;
    if (segmentStartedAtRef.current) {
      accumulatedMsRef.current += Date.now() - segmentStartedAtRef.current;
      segmentStartedAtRef.current = 0;
      setElapsedMs(accumulatedMsRef.current);
    }
    recorderRef.current.pause();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== 'paused') return;
    segmentStartedAtRef.current = Date.now();
    recorderRef.current.resume();
    setPhase('recording');
  }, []);

  const restore = useCallback(async (candidate: DiscussionDraft) => {
    const restored = { ...candidate, state: 'stopped' as const, updatedAt: Date.now() };
    await saveDiscussionDraft(restored);
    draftRef.current = restored;
    accumulatedMsRef.current = restored.durationMs;
    segmentStartedAtRef.current = 0;
    setDraft(restored);
    setElapsedMs(restored.durationMs);
    setError(null);
    setPhase('stopped');
  }, []);

  const discard = useCallback(async (draftId: string) => {
    await deleteDiscussionDraft(draftId);
    if (draftRef.current?.id === draftId) {
      draftRef.current = null;
      setDraft(null);
      setElapsedMs(0);
      setPhase('idle');
    }
    await refreshRecoverableDrafts();
  }, [refreshRecoverableDrafts]);

  const buildFile = useCallback(async (): Promise<File | null> => {
    const current = draftRef.current;
    if (!current) return null;
    const chunks = await listDiscussionDraftChunks(current.id);
    if (chunks.length === 0) return null;
    const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: current.mimeType });
    return new File(
      [blob],
      `discussion-${current.startedAt}.${extensionForMimeType(current.mimeType)}`,
      { type: current.mimeType },
    );
  }, []);

  const markUploadFailed = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    const failed = { ...current, state: 'upload_failed' as const, updatedAt: Date.now() };
    await saveDiscussionDraft(failed);
    draftRef.current = failed;
    setDraft(failed);
    await refreshRecoverableDrafts();
  }, [refreshRecoverableDrafts]);

  const reset = useCallback(() => {
    draftRef.current = null;
    accumulatedMsRef.current = 0;
    segmentStartedAtRef.current = 0;
    setDraft(null);
    setElapsedMs(0);
    setError(null);
    setPhase('idle');
  }, []);

  return {
    phase,
    draft,
    recoverableDrafts,
    elapsedMs,
    error,
    start,
    pause,
    resume,
    stop,
    restore,
    discard,
    buildFile,
    markUploadFailed,
    reset,
    refreshRecoverableDrafts,
  };
}
