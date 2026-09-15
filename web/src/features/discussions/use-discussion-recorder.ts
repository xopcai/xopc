import { acquireMicrophoneLease, releaseMicrophoneLease } from '@/features/voice/microphone-lease';
import { DISCUSSION_MAX_DURATION_MS, DISCUSSION_CHUNK_MAX_BYTES } from '@xopcai/gateway-contract';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteDiscussionDraft,
  listDiscussionDrafts,
  saveDiscussionDraft,
  saveDiscussionDraftChunk,
} from './discussion-draft-store';
import { LivePcmSegmenter, type LivePcmSegment } from './live-pcm-segmenter';
import type { DiscussionDraft } from './discussion-types';

const MAX_RECORDING_MS = DISCUSSION_MAX_DURATION_MS;
const MIN_AVAILABLE_BYTES = 100 * 1024 * 1024;

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

export function useDiscussionRecorder() {
  const microphoneOwner = useRef(Symbol('meeting-capture'));
  const captureGeneration = useRef(0);
  const stopPromise = useRef<Promise<DiscussionDraft | null> | null>(null);
  const [phase, setPhase] = useState<DiscussionRecorderPhase>('idle');
  const [draft, setDraft] = useState<DiscussionDraft | null>(null);
  const [recoverableDrafts, setRecoverableDrafts] = useState<DiscussionDraft[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscriptionAvailable, setLiveTranscriptionAvailable] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmenterRef = useRef<LivePcmSegmenter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const draftRef = useRef<DiscussionDraft | null>(null);
  const chunkIndexRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const segmentStartedAtRef = useRef(0);
  const persistQueueRef = useRef(Promise.resolve());
  const intervalRef = useRef<number | null>(null);

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
    intervalRef.current = null;
    releaseMicrophoneLease(microphoneOwner.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => {
    captureGeneration.current += 1;
    segmenterRef.current?.cancel();
    stopTimersAndStream();
  }, [stopTimersAndStream]);

  const persistChunk = useCallback((blob: Blob) => {
    const active = draftRef.current;
    if (!active || blob.size === 0) return;
    const firstIndex = chunkIndexRef.current;
    chunkIndexRef.current += Math.ceil(blob.size / DISCUSSION_CHUNK_MAX_BYTES);
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      for (let offset = 0, index = firstIndex; offset < blob.size; offset += DISCUSSION_CHUNK_MAX_BYTES, index += 1) {
        const current = draftRef.current;
        if (!current || current.id !== active.id) return;
        const updated = {
          ...current, chunkCount: index + 1,
          durationMs: Math.max(current.durationMs, accumulatedMsRef.current + (segmentStartedAtRef.current ? Date.now() - segmentStartedAtRef.current : 0)),
          updatedAt: Date.now(),
        };
        await saveDiscussionDraftChunk({ draftId: active.id, index, blob: blob.slice(offset, offset + DISCUSSION_CHUNK_MAX_BYTES), createdAt: Date.now() }, updated);
        draftRef.current = updated;
        setDraft(updated);
      }
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : 'Local recording storage failed');
      setPhase('error');
      segmenterRef.current?.cancel();
      stopTimersAndStream();
    });
  }, [stopTimersAndStream]);

  const stopOnce = useCallback(async (): Promise<DiscussionDraft | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return draftRef.current;
    setPhase('stopping');
    if (recorder.state === 'recording' && segmentStartedAtRef.current) {
      accumulatedMsRef.current += Date.now() - segmentStartedAtRef.current;
      segmentStartedAtRef.current = 0;
    }
    const lastSequence = segmenterRef.current
      ? await segmenterRef.current.stop().catch(() => -1)
      : -1;
    segmenterRef.current = null;
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
    const stopped: DiscussionDraft = {
      ...current,
      state: 'stopped',
      lastSequence,
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

  const stop = useCallback(() => {
    if (stopPromise.current) return stopPromise.current;
    const pending = stopOnce().finally(() => { stopPromise.current = null; });
    stopPromise.current = pending;
    return pending;
  }, [stopOnce]);

  const start = useCallback(async (input: {
    projectId?: string;
    onLiveSegment: (draftId: string, segment: LivePcmSegment) => Promise<void> | void;
  }): Promise<DiscussionDraft | null> => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this environment.');
      setPhase('error');
      return null;
    }
    if (!acquireMicrophoneLease(microphoneOwner.current)) { setError('The microphone is being used by a voice call. End the call before recording.'); return null; }
    const generation = ++captureGeneration.current;
    setError(null);
    setPhase('requesting_permission');
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota != null && estimate.usage != null && estimate.quota - estimate.usage < MIN_AVAILABLE_BYTES) {
        throw new Error('Not enough local storage for a discussion recording.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== captureGeneration.current) { stream.getTracks().forEach(track => track.stop()); releaseMicrophoneLease(microphoneOwner.current); return null; }
      streamRef.current = stream;
      const selectedMimeType = pickAudioMimeType();
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
      const now = Date.now();
      const nextDraft: DiscussionDraft = {
        id: crypto.randomUUID(),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        mimeType: recorder.mimeType || selectedMimeType || 'audio/webm',
        startedAt: now,
        updatedAt: now,
        durationMs: 0,
        chunkCount: 0,
        lastSequence: -1,
        state: 'recording',
      };
      await saveDiscussionDraft(nextDraft);
      await navigator.storage?.persist?.().catch(() => false);
      recorderRef.current = recorder;
      draftRef.current = nextDraft;
      chunkIndexRef.current = 0;
      accumulatedMsRef.current = 0;
      segmentStartedAtRef.current = now;
      persistQueueRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => persistChunk(event.data);
      recorder.onerror = () => { setError('The microphone stopped unexpectedly. Saved audio can be recovered.'); void stop(); };
      stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => void stop(), { once: true }));
      recorder.start(5_000);
      try {
        segmenterRef.current = await LivePcmSegmenter.start(
          stream,
          (segment) => input.onLiveSegment(nextDraft.id, segment),
        );
        setLiveTranscriptionAvailable(true);
      } catch {
        segmenterRef.current = null;
        setLiveTranscriptionAvailable(false);
      }
      setDraft(nextDraft);
      setElapsedMs(0);
      setPhase('recording');
      intervalRef.current = window.setInterval(() => {
        const elapsed = accumulatedMsRef.current + (segmentStartedAtRef.current ? Date.now() - segmentStartedAtRef.current : 0);
        setElapsedMs(elapsed);
        if (elapsed >= MAX_RECORDING_MS) void stop();
      }, 1_000);

      return nextDraft;
    } catch (caught) {
      segmenterRef.current?.cancel();
      segmenterRef.current = null;
      stopTimersAndStream();
      setError(caught instanceof Error ? caught.message : 'Microphone permission was denied.');
      setPhase('error');
      return null;
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
    segmenterRef.current?.pause();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== 'paused') return;
    segmentStartedAtRef.current = Date.now();
    recorderRef.current.resume();
    segmenterRef.current?.resume();
    setPhase('recording');
  }, []);

  const setServerDiscussionId = useCallback(async (serverDiscussionId: string) => {
    const current = draftRef.current;
    if (!current) return;
    const updated = { ...current, serverDiscussionId, updatedAt: Date.now() };
    draftRef.current = updated;
    setDraft(updated);
    await saveDiscussionDraft(updated);
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
    liveTranscriptionAvailable,
    start,
    pause,
    resume,
    stop,
    restore,
    discard,
    markUploadFailed,
    reset,
    setServerDiscussionId,
    refreshRecoverableDrafts,
  };
}
