import type { DiscussionDraft, DiscussionDetail, DiscussionTranscript } from './discussion-types';
import type { DiscussionRecorderPhase } from './use-discussion-recorder';

export type RecordingSyncStage = 'pending' | 'uploading' | 'verifying' | 'available' | 'failed';
export function verifiedSavedThrough(draft: DiscussionDraft | null | undefined): number | null {
  if ((draft?.epochs?.length ?? 0) > 1) {
    const prefix = draft?.epochs?.[0]?.savedThroughMs;
    return Number.isFinite(prefix) && prefix! >= 0 ? prefix! : null;
  }
  const proof = draft?.mediaCoverage;
  return proof?.version === 1 && proof.committedChunkCount === draft?.chunkCount
    && Number.isFinite(proof.verifiedThroughMs) && proof.verifiedThroughMs >= 0
    && Number.isFinite(proof.observedThroughMs) && proof.observedThroughMs >= proof.verifiedThroughMs
    ? proof.verifiedThroughMs : null;
}

export function projectRecordingStatus(input: {
  phase: DiscussionRecorderPhase; draft?: DiscussionDraft | null; locallyFinalized?: DiscussionDraft | null;
  online: boolean; syncStage: RecordingSyncStage; detail?: DiscussionDetail | null;
  transcript?: DiscussionTranscript | null; pendingText: number; liveAvailable: boolean;
}) {
  const { phase, detail } = input;
  const draft = input.draft ?? input.locallyFinalized;
  const interrupted = draft?.saveOutcome === 'interrupted';
  const capture = phase === 'recording' ? 'recording' : phase === 'paused' ? 'paused'
    : phase === 'requesting_permission' || phase === 'waiting_for_audio' ? 'waitingAudio'
    : phase === 'stopping' ? 'stopping' : phase === 'error' || interrupted ? 'interrupted' : 'stopped';
  const savedThroughMs = verifiedSavedThrough(draft);
  const localComplete = !!draft?.chunkCount && draft.state !== 'recording' && draft.saveOutcome === 'complete' && (phase === 'stopped' || phase === 'idle');
  const save = phase === 'error' || draft?.saveOutcome === 'incomplete' ? 'saveFailed'
    : localComplete ? 'localComplete' : savedThroughMs !== null && savedThroughMs > 0 ? 'savedThrough'
    : draft?.chunkCount ? 'savedUnknown' : 'saving';
  const audioReady = !!detail?.discussion.audioAttachmentId && !detail.discussion.audioDeletedAt;
  const sync = detail?.discussion.audioDeletedAt ? 'failed' : audioReady ? 'available' : !input.online ? 'offline' : input.syncStage;
  const status = detail?.discussion.status;
  const ai = status === 'completed' ? 'aiComplete' : status === 'needs_attention' ? 'aiFailed'
    : detail?.processing?.nextAttemptAt ? 'aiRetrying' : status === 'organizing' ? 'analyzing'
    : status === 'sealing' ? 'transcribing'
    : capture === 'recording' && (!input.liveAvailable || input.pendingText > 0 || (input.transcript?.stats?.failed ?? 0) > 0) ? 'textDelayed'
    : capture === 'recording' ? 'liveText' : 'waitingSource';
  const timingUncertain = !!draft?.chunkCount && (savedThroughMs === null || draft?.mediaCoverage?.status !== 'verified');
  const hasInterruptions = (draft?.epochs?.length ?? 0) > 1;
  return { capture, save, sync, ai, hasInterruptions, savedThroughMs, localComplete, interrupted, timingUncertain } as const;
}
