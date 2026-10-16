import { describe, expect, it } from 'vitest';

import { projectRecordingStatus, verifiedSavedThrough } from '../recording-status';
import type { DiscussionDraft, DiscussionDetail } from '../discussion-types';

const draft: DiscussionDraft = { id: 'local', startedAt: 1, updatedAt: 1, durationMs: 90_000, chunkCount: 2,
  mimeType: 'audio/webm', state: 'recording', lastSequence: -1,
  mediaCoverage: { version: 1, verifiedThroughMs: 20_000, observedThroughMs: 80_000, status: 'gap', committedChunkCount: 2 } };
const base = { phase: 'recording' as const, draft, online: true, syncStage: 'pending' as const, pendingText: 0, liveAvailable: true };
const detail = (status: string, audio = true) => ({ discussion: { status, ...(audio ? { audioAttachmentId: 'audio' } : {}) } }) as DiscussionDetail;

describe('recording state projection', () => {
  it('uses the continuous media prefix rather than elapsed time or the latest packet timestamp', () => {
    expect(projectRecordingStatus(base).savedThroughMs).toBe(20_000);
    expect(verifiedSavedThrough({ ...draft, mediaCoverage: undefined })).toBeNull();
    expect(verifiedSavedThrough({ ...draft, chunkCount: 3 })).toBeNull();
    expect(verifiedSavedThrough({ ...draft, mediaCoverage: { ...draft.mediaCoverage!, verifiedThroughMs: NaN } })).toBeNull();
  });
  it('keeps offline capture, local commits and delayed text independent', () => {
    expect(projectRecordingStatus({ ...base, online: false, pendingText: 2 })).toMatchObject({
      capture: 'recording', save: 'savedThrough', sync: 'offline', ai: 'textDelayed', localComplete: false,
    });
  });
  it('keeps the continuous saved prefix before an interruption instead of adding the resumed media time', () => {
    const resumed = { ...draft, mediaCoverage: { ...draft.mediaCoverage!, verifiedThroughMs: 9000 },
      epochs: [{ firstChunk: 0, startedAt: 1, mimeType: 'audio/webm', savedThroughMs: 3000 }, { firstChunk: 1, startedAt: 10000, mimeType: 'audio/webm' }] };
    expect(projectRecordingStatus({ ...base, draft: resumed })).toMatchObject({ savedThroughMs: 3000, hasInterruptions: true });
  });

  it('does not treat permission, stop-in-flight or uploaded bytes as completion', () => {
    expect(projectRecordingStatus({ ...base, phase: 'waiting_for_audio' }).capture).toBe('waitingAudio');
    expect(projectRecordingStatus({ ...base, phase: 'stopping', draft: { ...draft, saveOutcome: 'complete' }, syncStage: 'verifying' }))
      .toMatchObject({ capture: 'stopping', localComplete: false, sync: 'verifying' });
  });
  it('allows leaving after the local barrier while sync and AI remain pending', () => {
    expect(projectRecordingStatus({ ...base, phase: 'stopped', draft: { ...draft, state: 'stopped', saveOutcome: 'complete' }, syncStage: 'uploading' }))
      .toMatchObject({ localComplete: true, capture: 'stopped', sync: 'uploading', ai: 'waitingSource' });
  });
  it.each(['interrupted', 'incomplete'] as const)('does not claim complete preservation for %s audio', saveOutcome => {
    expect(projectRecordingStatus({ ...base, phase: 'stopped', draft: { ...draft, state: 'stopped', saveOutcome } }).localComplete).toBe(false);
  });
  it('retains source availability when AI fails and does not treat a source outage as an AI failure', () => {
    expect(projectRecordingStatus({ ...base, phase: 'idle', online: false, detail: detail('needs_attention') }))
      .toMatchObject({ capture: 'stopped', sync: 'available', ai: 'aiFailed' });
    expect(projectRecordingStatus({ ...base, detail: detail('recording', false), syncStage: 'failed' }))
      .toMatchObject({ capture: 'recording', sync: 'failed', ai: 'liveText' });
  });
  it('does not claim availability for a deleted original even when an earlier sync callback succeeded', () => {
    const deleted = detail('completed'); deleted.discussion.audioDeletedAt = 1;
    expect(projectRecordingStatus({ ...base, phase: 'stopped', detail: deleted, syncStage: 'available' }).sync).toBe('failed');
  });
  it('projects persisted retries and keeps a local receipt after the draft is cleaned up', () => {
    const finalized = { ...draft, state: 'stopped' as const, saveOutcome: 'complete' as const };
    expect(projectRecordingStatus({ ...base, phase: 'idle', draft: null, locallyFinalized: finalized,
      detail: { ...detail('organizing'), processing: { fromAudio: false, completedChunks: 1, transcribedMs: 20_000, attemptCount: 1, maxAttempts: 3, nextAttemptAt: 100 } } }))
      .toMatchObject({ localComplete: true, sync: 'available', ai: 'aiRetrying' });
  });
});
