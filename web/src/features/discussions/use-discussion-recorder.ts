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
import { acquireRecordingLease } from './recording-lease';
import { newAnnotation, saveLocalAnnotation, resolveLocalAnnotationAnchor } from './discussion-annotation-store';
import { CaptureClock } from './captureClock';
import { RecordingMediaCoverageReader } from './recording-media-coverage';
import { LivePcmSegmenter, type LivePcmSegment } from './live-pcm-segmenter';
import type { DiscussionDraft } from './discussion-types';

const MAX_RECORDING_MS = DISCUSSION_MAX_DURATION_MS;
const MIN_AVAILABLE_BYTES = 100 * 1024 * 1024;
const MAX_PENDING_BYTES = 32 * 1024 * 1024;

export type DiscussionRecorderPhase =
  | 'idle'
  | 'requesting_permission'
  | 'waiting_for_audio'
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
  const recordingLease = useRef<(() => void) | null>(null);
  const releaseRecordingLease = () => { recordingLease.current?.(); recordingLease.current = null; };
  const pendingMarks = useRef<{ id: string; at: number; target?: number; saved: Promise<void> }[]>([]);
  const [markerMessage, setMarkerMessage] = useState<string | null>(null);
  const [markerError, setMarkerError] = useState<string | null>(null);
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
  const mediaReaderRef = useRef<RecordingMediaCoverageReader | null>(null);
  const interruptedRef = useRef(false);
  const acceptingChunksRef = useRef(false);
  const lastAudioAtRef = useRef(0);
  const [inputLevel, setInputLevel] = useState<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lifecycleCleanupRef = useRef<(() => void) | null>(null);
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
    lifecycleCleanupRef.current?.();
    lifecycleCleanupRef.current = null;
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
    if (!active || !acceptingChunksRef.current || storageErrorRef.current) return;
    if (blob.size === 0) {
      const deliveredAt = performance.now();
      persistQueueRef.current = persistQueueRef.current.then(() => {
        const clock = mediaReaderRef.current?.packetClock();
        if (draftRef.current?.id === active.id && clock?.verified) for (const mark of pendingMarks.current) if (mark.at <= deliveredAt) mark.target ??= clock.durationMs;
      });
      return;
    }
    if (pendingBytesRef.current + blob.size > MAX_PENDING_BYTES) {
      failStorage(new Error('Local storage cannot keep up with recording'));
      return;
    }
    const capturedDurationMs = clockRef.current.elapsedMs;
    const deliveredAt = performance.now();
    pendingBytesRef.current += blob.size;
    const firstIndex = chunkIndexRef.current;
    chunkIndexRef.current += Math.ceil(blob.size / DISCUSSION_CHUNK_MAX_BYTES);
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      const beforeDecoded = mediaReaderRef.current?.packetClock().durationMs ?? 0;
      for (let offset = 0, index = firstIndex; offset < blob.size; offset += DISCUSSION_CHUNK_MAX_BYTES, index += 1) {
        if (storageErrorRef.current) return;
        const current = draftRef.current;
        if (!current || current.id !== active.id) return;
        const part = blob.slice(offset, offset + DISCUSSION_CHUNK_MAX_BYTES);
        const previousMediaEnd = mediaReaderRef.current?.snapshot().observedThroughMs ?? 0;
        const coverage = mediaReaderRef.current?.append(new Uint8Array(await part.arrayBuffer()));
        if (coverage && coverage.observedThroughMs > previousMediaEnd) {
          lastAudioAtRef.current = Math.max(lastAudioAtRef.current, deliveredAt);
          if (performance.now() - deliveredAt < 15_000 && recorderRef.current?.state === 'recording') setPhase(phase => phase === 'waiting_for_audio' ? 'recording' : phase);
        }
        const updated = {
          ...current, chunkCount: index + 1,
          durationMs: offset + DISCUSSION_CHUNK_MAX_BYTES >= blob.size ? Math.max(current.durationMs, capturedDurationMs) : current.durationMs,
          updatedAt: Date.now(),
          ...(coverage ? { mediaCoverage: { ...coverage, committedChunkCount: index + 1 } } : {}),
        };
        await saveDiscussionDraftChunk({ draftId: active.id, index, blob: part, createdAt: Date.now() }, updated);
        if (draftRef.current?.id !== active.id) return;
        draftRef.current = updated;
        setDraft(updated);
        const packetClock = mediaReaderRef.current?.packetClock();
        if (packetClock?.verified && offset + DISCUSSION_CHUNK_MAX_BYTES >= blob.size) {
          const candidates = pendingMarks.current.filter(mark => mark.at <= deliveredAt);
          if (packetClock.durationMs <= beforeDecoded) {
            for (const mark of candidates) mark.target ??= packetClock.durationMs;
          } else {
            const ready = candidates.filter(mark => mark.target === undefined || mark.target < packetClock.durationMs);
            const readyIds = new Set(ready.map(mark => mark.id));
            pendingMarks.current = pendingMarks.current.filter(mark => !readyIds.has(mark.id));
            for (const mark of ready) {
              const position = mark.target ?? Math.max(0,packetClock.durationMs - 1);
              void mark.saved.then(() => resolveLocalAnnotationAnchor(active.id,mark.id,position))
                .catch(error => setMarkerError(error instanceof Error ? error.message : 'Could not locate the saved highlight'));
            }
          }
        }
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
      acceptingChunksRef.current = false;
      stopTimersAndStream();
      setInputLevel(null);
    }
    await persistQueueRef.current;
    const current = draftRef.current;
    if (!current) return null;
    const stopped: DiscussionDraft = {
      ...current, state: 'stopped', lastSequence: -1,
      // Persisted chunk metadata is the recovery boundary, never the UI clock.
      durationMs: current.durationMs, updatedAt: Date.now(), endedAt: Date.now(),
      saveOutcome: storageErrorRef.current || stopError || !current.chunkCount ? 'incomplete' : interruptedRef.current ? 'interrupted' : 'complete',
    };
    try {
      await saveDiscussionDraft(stopped);
      draftRef.current = stopped;
      setDraft(stopped);
      setElapsedMs(stopped.durationMs);
      if (storageErrorRef.current) throw storageErrorRef.current;
      if (stopError) throw stopError;
      if (!current.chunkCount) throw new Error('No audio was saved');
      setPhase('stopped');
      return stopped;
    } catch (caught) {
      setPhase('error');
      setError(storageErrorRef.current
        ? 'Local storage failed. Recover the previously saved portion after freeing space.'
        : caught instanceof Error ? caught.message : 'Recording could not finish');
      throw caught;
    } finally {
      releaseRecordingLease();
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
    continuation?: DiscussionDraft;
    gatewayUrl?: string;
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
      interruptedRef.current = false;
      acceptingChunksRef.current = false;
      setInputLevel(null);
      pendingBytesRef.current = 0;
      pendingMarks.current = []; setMarkerMessage(null); setMarkerError(null);
      if (input.continuation) recordingLease.current = await acquireRecordingLease(input.continuation.id);
      const previous = input.continuation ? await loadDiscussionDraftForRecovery(input.continuation.id) : null;
      if (previous?.sealRequested) throw new Error('Recording has already been submitted. Recover and sync it first.');
      if (previous && previous.gatewayUrl !== input.gatewayUrl) throw new Error('Return to the original Gateway before continuing this recording.');
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota != null && estimate.usage != null && estimate.quota - estimate.usage < MIN_AVAILABLE_BYTES) {
        throw new Error('Not enough local storage for a discussion recording.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== captureGeneration.current) { stream.getTracks().forEach(track => track.stop()); releaseMicrophoneLease(microphoneOwner.current); releaseRecordingLease(); return null; }
      streamRef.current = stream;
      const selectedMimeType = pickAudioMimeType();
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
      const now = Date.now();
      const mimeType = recorder.mimeType || selectedMimeType || 'audio/webm';
      const epochs = previous ? [...(previous.epochs ?? [{ firstChunk: 0, mimeType: previous.mimeType, startedAt: previous.startedAt }])]
        : [{ firstChunk: 0, mimeType, startedAt: now }];
      if (previous) {
        epochs[epochs.length - 1] = { ...epochs[epochs.length - 1], savedThroughMs: previous.mediaCoverage?.committedChunkCount === previous.chunkCount ? previous.mediaCoverage.verifiedThroughMs : undefined };
        epochs.push({ firstChunk: previous.chunkCount, mimeType, startedAt: now, previousEndedAt: previous.endedAt ?? previous.updatedAt });
      }
      const nextDraft: DiscussionDraft = {
        id: previous?.id ?? crypto.randomUUID(),
        ...previous,
        gatewayUrl: input.gatewayUrl,
        epochs,
        mediaCoverage: undefined,
        endedAt: undefined,
        saveOutcome: undefined,
        consentPolicyVersion: input.consentPolicyVersion ?? previous?.consentPolicyVersion,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        mimeType,
        startedAt: previous?.startedAt ?? now,
        updatedAt: now,
        durationMs: previous?.durationMs ?? 0,
        chunkCount: previous?.chunkCount ?? 0,
        lastSequence: -1,
        state: 'recording',
      };
      if (!recordingLease.current) recordingLease.current = await acquireRecordingLease(nextDraft.id);
      await saveDiscussionDraft(nextDraft);
      void navigator.storage?.persist?.().catch(() => false);
      if (generation !== captureGeneration.current) { stopTimersAndStream(); releaseRecordingLease(); return null; }
      recorderRef.current = recorder;
      draftRef.current = nextDraft;
      chunkIndexRef.current = nextDraft.chunkCount;
      mediaReaderRef.current = new RecordingMediaCoverageReader(nextDraft.mimeType);
      acceptingChunksRef.current = true;
      lastAudioAtRef.current = performance.now();
      clockRef.current.reset(nextDraft.durationMs);
      clockRef.current.resume();
      persistQueueRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => { if (draftRef.current?.id === nextDraft.id && recorderRef.current === recorder) persistChunk(event.data); };
      const interrupt = () => {
        if (draftRef.current?.id !== nextDraft.id || recorderRef.current !== recorder || !acceptingChunksRef.current) return;
        interruptedRef.current = true;
        clockRef.current.pause();
        setPhase('stopping');
        setError('The microphone stopped unexpectedly. Recover the saved audio.');
        void stop().catch(() => undefined);
      };
      recorder.onerror = interrupt;
      recorderStoppedRef.current = new Promise<void>((resolve) => {
        recorder.onstop = () => { resolve(); if (!stopPromise.current) interrupt(); };
      });
      const tracks = stream.getAudioTracks();
      const checkSource = () => {
        if (tracks.some(track => track.muted || track.readyState === 'ended')) interrupt();
      };
      // Muted sources may still produce encoded silence and PCM callbacks.
      // Close this epoch so a missing interval cannot appear to be complete audio.
      tracks.forEach(track => {
        track.addEventListener('ended', interrupt);
        track.addEventListener('mute', interrupt);
      });
      document.addEventListener('freeze', interrupt);
      document.addEventListener('visibilitychange', checkSource);
      window.addEventListener('pageshow', checkSource);
      lifecycleCleanupRef.current = () => {
        tracks.forEach(track => {
          track.removeEventListener('ended', interrupt);
          track.removeEventListener('mute', interrupt);
        });
        document.removeEventListener('freeze', interrupt);
        document.removeEventListener('visibilitychange', checkSource);
        window.removeEventListener('pageshow', checkSource);
      };
      recorder.start(5_000);
      let lastLevelAt = -Infinity;
      void LivePcmSegmenter.start(stream, (segment) => {
        if (previous) return; // Rebuild resumed text from sealed source; never overwrite prior live sequence IDs.
        return input.onLiveSegment(nextDraft.id, segment);
      }, level => {
        if (generation !== captureGeneration.current || recorder.state !== 'recording') return;
        lastAudioAtRef.current = performance.now();
        setPhase(current => current === 'waiting_for_audio' ? 'recording' : current);
        if (performance.now() - lastLevelAt >= 200) { lastLevelAt = performance.now(); setInputLevel(level); }
      })
        .then((segmenter) => {
          if (generation !== captureGeneration.current || recorder.state === 'inactive') { cancelLiveSegmenter(segmenter); return; }
          segmenterRef.current = segmenter;
          setLiveTranscriptionAvailable(!previous);
        }).catch(() => setLiveTranscriptionAvailable(false));
      setDraft(nextDraft);
      setElapsedMs(nextDraft.durationMs);
      setPhase('waiting_for_audio');
      checkSource();
      intervalRef.current = window.setInterval(() => {
        if (recorder.state === 'inactive' && !stopPromise.current) { interrupt(); return; }
        if (recorder.state === 'recording' && performance.now() - lastAudioAtRef.current >= 15_000) {
          setPhase(phase => phase === 'recording' ? 'waiting_for_audio' : phase); setInputLevel(null);
        }
        const elapsed = clockRef.current.elapsedMs;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_RECORDING_MS) void stop().catch(() => undefined);
      }, 1_000);

      return nextDraft;
    } catch (caught) {
      cancelLiveSegmenter(segmenterRef.current);
      acceptingChunksRef.current = false;
      segmenterRef.current = null;
      stopTimersAndStream();
      releaseRecordingLease();
      setError(caught instanceof Error ? caught.message : 'Microphone permission was denied.');
      setPhase('error');
      return null;
    } finally { startInFlightRef.current = false; }
  }, [persistChunk, stop, stopTimersAndStream]);

  const mark = useCallback(async () => {
    const draft = draftRef.current; const recorder = recorderRef.current;
    if (!draft || !recorder || recorder.state !== 'recording') return;
    const annotation = newAnnotation({ type: 'time', capturedAt: Date.now(), epoch: (draft.epochs?.length ?? 1) - 1,coordinate: 'pcm' });
    setMarkerError(null);
    const saved = saveLocalAnnotation(draft.id,annotation);
    pendingMarks.current.push({ id: annotation.id,at: performance.now(),saved });
    try { recorder.requestData(); } catch { /* A stopped source leaves an explicit unresolved anchor. */ }
    try { await saved; setMarkerMessage('saved'); }
    catch (error) {
      pendingMarks.current = pendingMarks.current.filter(mark => mark.id !== annotation.id);
      setMarkerError(error instanceof Error ? error.message : 'Highlight could not be saved');
    }
  }, []);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== 'recording') return;
    clockRef.current.pause();
    setElapsedMs(clockRef.current.elapsedMs);
    recorderRef.current.pause();
    segmenterRef.current?.pause();
    setPhase('paused');
    setInputLevel(null);
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== 'paused') return;
    clockRef.current.resume();
    recorderRef.current.resume();
    segmenterRef.current?.resume();
    setPhase('waiting_for_audio');
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
    if (recorderRef.current || startInFlightRef.current || stopPromise.current) throw new Error('Stop the active recording before recovery.');
    await persistQueueRef.current;
    storageErrorRef.current = null;
    const committed = await loadDiscussionDraftForRecovery(candidate.id);
    const restored = { ...committed, endedAt: committed.endedAt ?? committed.updatedAt, state: 'stopped' as const, updatedAt: Date.now() };
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
    if (recorderRef.current || startInFlightRef.current || stopPromise.current) throw new Error('Stop the active recording before discarding.');
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

  const markUploadFailed = useCallback(async (draftId?: string) => {
    const id = draftId ?? draftRef.current?.id;
    if (!id) return;
    const current = (await listDiscussionDrafts()).find(candidate => candidate.id === id);
    if (!current || current.state === 'recording') return;
    const failed = { ...current, state: 'upload_failed' as const, updatedAt: Date.now() };
    await saveDiscussionDraft(failed);
    if (draftRef.current?.id === id) { draftRef.current = failed; setDraft(failed); }
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
    inputLevel,
    mark, markerMessage, markerError,
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
