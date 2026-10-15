import { acquireMicrophoneLease, releaseMicrophoneLease } from '@/features/voice/microphone-lease';
import { DISCUSSION_MAX_DURATION_MS, DISCUSSION_CHUNK_MAX_BYTES } from '@xopcai/gateway-contract';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteDiscussionDraft,
  listDiscussionDrafts,
  loadDiscussionDraftForRecovery,
  saveDiscussionDraft,
  saveDiscussionDraftChunk,
} from './discussion-draft-store';
import { CaptureClock } from './captureClock';
import { LivePcmSegmenter, type LivePcmSegment } from './live-pcm-segmenter';
import type { DiscussionDraft } from './discussion-types';

const MAX_RECORDING_MS = DISCUSSION_MAX_DURATION_MS;
const MIN_AVAILABLE_BYTES = 100 * 1024 * 1024;
const MAX_PENDING_BYTES = 32 * 1024 * 1024;

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

function cancelLiveSegmenter(segmenter: LivePcmSegmenter | null): void {
  try { segmenter?.cancel(); } catch { /* Live capture teardown must never block original audio. */ }
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
  const recorderStoppedRef = useRef<Promise<void>>(Promise.resolve());
  const segmenterRef = useRef<LivePcmSegmenter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const draftRef = useRef<DiscussionDraft | null>(null);
  const chunkIndexRef = useRef(0);
  const clockRef = useRef(new CaptureClock());
  const persistQueueRef = useRef(Promise.resolve());
  const pendingBytesRef = useRef(0);
  const storageErrorRef = useRef<Error | null>(null);
  const intervalRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);
  const stopRef = useRef<() => Promise<DiscussionDraft | null>>(() => Promise.resolve(null));

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
    if (!draftRef.current) stopTimersAndStream();
    void stopRef.current().catch(() => undefined);
  }, [stopTimersAndStream]);

  const failStorage = useCallback((caught: unknown) => {
    storageErrorRef.current ??= caught instanceof Error ? caught : new Error('Local recording storage failed');
    clockRef.current.pause();
    setError('Local recording storage failed. Only previously saved audio can be recovered.');
    cancelLiveSegmenter(segmenterRef.current);
    void stopRef.current().catch(() => undefined);
  }, []);

  const persistChunk = useCallback((blob: Blob) => {
    const active = draftRef.current;
    if (!active || blob.size === 0 || storageErrorRef.current) return;
    if (pendingBytesRef.current + blob.size > MAX_PENDING_BYTES) {
      failStorage(new Error('Local storage cannot keep up with recording'));
      return;
    }
    const capturedDurationMs = clockRef.current.elapsedMs;
    pendingBytesRef.current += blob.size;
    const firstIndex = chunkIndexRef.current;
    chunkIndexRef.current += Math.ceil(blob.size / DISCUSSION_CHUNK_MAX_BYTES);
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      for (let offset = 0, index = firstIndex; offset < blob.size; offset += DISCUSSION_CHUNK_MAX_BYTES, index += 1) {
        if (storageErrorRef.current) return;
        const current = draftRef.current;
        if (!current || current.id !== active.id) return;
        const updated = {
          ...current, chunkCount: index + 1,
          durationMs: offset + DISCUSSION_CHUNK_MAX_BYTES >= blob.size ? Math.max(current.durationMs, capturedDurationMs) : current.durationMs,
          updatedAt: Date.now(),
        };
        await saveDiscussionDraftChunk({ draftId: active.id, index, blob: blob.slice(offset, offset + DISCUSSION_CHUNK_MAX_BYTES), createdAt: Date.now() }, updated);
        if (draftRef.current?.id !== active.id) return;
        draftRef.current = updated;
        setDraft(updated);
      }
    }).catch((caught) => {
      failStorage(caught);
    }).finally(() => {
      pendingBytesRef.current -= blob.size;
    });
  }, [failStorage]);

  const stopOnce = useCallback(async (): Promise<DiscussionDraft | null> => {
    const recorder = recorderRef.current;
    if (!draftRef.current) return null;
    if (!recorder && draftRef.current.state !== 'recording') return draftRef.current;
    ++captureGeneration.current;
    setPhase('stopping');
    clockRef.current.pause();
    setElapsedMs(clockRef.current.elapsedMs);
    const segmenter = segmenterRef.current;
    segmenterRef.current = null;
    // Original audio must stop and reach durable storage independently of live STT.
    cancelLiveSegmenter(segmenter);
    let stopError: Error | undefined;
    try {
      if (recorder) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            reject(new Error('Recording stopped responding. Previously saved audio is available for recovery.'));
          }, 5_000);
          void recorderStoppedRef.current.then(() => { window.clearTimeout(timer); resolve(); });
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch (caught) {
            window.clearTimeout(timer);
            reject(caught);
          }
        });
      }
    } catch (caught) {
      stopError = caught instanceof Error ? caught : new Error('Recording could not finish');
    } finally {
      stopTimersAndStream();
    }
    await persistQueueRef.current;
    const current = draftRef.current;
    if (!current) return null;
    const stopped: DiscussionDraft = {
      ...current, state: 'stopped', lastSequence: -1,
      // Persisted chunk metadata is the recovery boundary, never the UI clock.
      durationMs: current.durationMs, updatedAt: Date.now(),
    };
    try {
      await saveDiscussionDraft(stopped);
      draftRef.current = stopped;
      setDraft(stopped);
      setElapsedMs(stopped.durationMs);
      if (storageErrorRef.current) throw storageErrorRef.current;
      if (stopError) throw stopError;
      setPhase('stopped');
      return stopped;
    } catch (caught) {
      setPhase('error');
      setError(storageErrorRef.current
        ? 'Local storage failed. Recover the previously saved portion after freeing space.'
        : caught instanceof Error ? caught.message : 'Recording could not finish');
      throw caught;
    } finally {
      await refreshRecoverableDrafts();
    }
  }, [refreshRecoverableDrafts, stopTimersAndStream]);

  const stop = useCallback(() => {
    if (stopPromise.current) return stopPromise.current;
    // Defer execution so synchronous stop events also see the same in-flight promise.
    const pending = Promise.resolve().then(stopOnce).finally(() => { stopPromise.current = null; });
    stopPromise.current = pending;
    return pending;
  }, [stopOnce]);
  stopRef.current = stop;

  const start = useCallback(async (input: {
    projectId?: string;
    consentPolicyVersion?: number;
    onLiveSegment: (draftId: string, segment: LivePcmSegment) => Promise<void> | void;
  }): Promise<DiscussionDraft | null> => {
    if (startInFlightRef.current || recorderRef.current || stopPromise.current) return null;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this environment.');
      setPhase('error');
      return null;
    }
    if (!acquireMicrophoneLease(microphoneOwner.current)) { setError('The microphone is being used by a voice call. End the call before recording.'); return null; }
    startInFlightRef.current = true;
    const generation = ++captureGeneration.current;
    setError(null);
    setPhase('requesting_permission');
    try {
      await persistQueueRef.current;
      storageErrorRef.current = null;
      pendingBytesRef.current = 0;
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
        consentPolicyVersion: input.consentPolicyVersion,
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
      void navigator.storage?.persist?.().catch(() => false);
      if (generation !== captureGeneration.current) { stopTimersAndStream(); return null; }
      recorderRef.current = recorder;
      draftRef.current = nextDraft;
      chunkIndexRef.current = 0;
      clockRef.current.reset();
      clockRef.current.resume();
      persistQueueRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => { if (draftRef.current?.id === nextDraft.id) persistChunk(event.data); };
      recorder.onerror = () => { setError('The microphone stopped unexpectedly. Recover the saved audio.'); void stop().catch(() => undefined); };
      recorderStoppedRef.current = new Promise<void>((resolve) => {
        recorder.onstop = () => { resolve(); void stop().catch(() => undefined); };
      });
      stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => { void stop().catch(() => undefined); }, { once: true }));
      recorder.start(5_000);
      void LivePcmSegmenter.start(stream, (segment) => input.onLiveSegment(nextDraft.id, segment))
        .then((segmenter) => {
          if (generation !== captureGeneration.current || recorder.state === 'inactive') { cancelLiveSegmenter(segmenter); return; }
          segmenterRef.current = segmenter;
          setLiveTranscriptionAvailable(true);
        }).catch(() => setLiveTranscriptionAvailable(false));
      setDraft(nextDraft);
      setElapsedMs(0);
      setPhase('recording');
      intervalRef.current = window.setInterval(() => {
        const elapsed = clockRef.current.elapsedMs;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_RECORDING_MS) void stop().catch(() => undefined);
      }, 1_000);

      return nextDraft;
    } catch (caught) {
      cancelLiveSegmenter(segmenterRef.current);
      segmenterRef.current = null;
      stopTimersAndStream();
      setError(caught instanceof Error ? caught.message : 'Microphone permission was denied.');
      setPhase('error');
      return null;
    } finally { startInFlightRef.current = false; }
  }, [persistChunk, stop, stopTimersAndStream]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== 'recording') return;
    clockRef.current.pause();
    setElapsedMs(clockRef.current.elapsedMs);
    recorderRef.current.pause();
    segmenterRef.current?.pause();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== 'paused') return;
    clockRef.current.resume();
    recorderRef.current.resume();
    segmenterRef.current?.resume();
    setPhase('recording');
  }, []);

  const setServerDiscussionId = useCallback(async (serverDiscussionId: string) => {
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      const current = draftRef.current;
      if (!current) return;
      const updated = { ...current, serverDiscussionId, updatedAt: Date.now() };
      await saveDiscussionDraft(updated);
      draftRef.current = updated;
      setDraft(updated);
    }).catch(failStorage);
    await persistQueueRef.current;
  }, [failStorage]);

  const restore = useCallback(async (candidate: DiscussionDraft) => {
    await persistQueueRef.current;
    storageErrorRef.current = null;
    const committed = await loadDiscussionDraftForRecovery(candidate.id);
    const restored = { ...committed, state: 'stopped' as const, updatedAt: Date.now() };
    await saveDiscussionDraft(restored);
    draftRef.current = restored;
    clockRef.current.reset(restored.durationMs);
    setDraft(restored);
    setElapsedMs(restored.durationMs);
    setError(null);
    setPhase('stopped');
    return restored;
  }, []);

  const discard = useCallback(async (draftId: string) => {
    await persistQueueRef.current;
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
    clockRef.current.reset();
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
