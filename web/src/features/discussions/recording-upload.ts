import { DISCUSSION_CHUNK_MAX_BYTES, type DiscussionRecordingJob } from '@xopcai/gateway-contract';

import { sealRecording, getRecordingJob, getDiscussion, getRecordingChunks, uploadRecordingChunk } from './discussion-api';
import { deleteDiscussionDraft, getDiscussionDraftChunk, saveDiscussionDraft, saveDiscussionDraftChunk } from './discussion-draft-store';
import type { DiscussionDraft } from './discussion-types';

async function checksum(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function waitForRecording(id: string, initial: DiscussionRecordingJob) {
  let job = initial;
  const deadline = performance.now() + 5 * 60_000;
  while (job.state === 'queued' || job.state === 'running') {
    if (performance.now() >= deadline) throw new Error('Recording is still processing. Your draft is saved; retry to check its result.');
    await new Promise(resolve => setTimeout(resolve, 1_000));
    job = await getRecordingJob(id);
  }
  if (job.state !== 'completed') throw new Error(job.error ?? 'Recording processing was cancelled');
  return getDiscussion(id);
}

/** Read and upload one persisted chunk at a time; never assemble a whole recording. */
export async function uploadDraftRecording(draft: DiscussionDraft, id: string, onProgress: (percent: number) => void, complete = true) {
  if (complete) {
    const detail = await getDiscussion(id);
    if (detail.discussion.audioAttachmentId) return detail;
    if (detail.recordingJob?.state === 'queued' || detail.recordingJob?.state === 'running') return waitForRecording(id, detail.recordingJob);
  }
  const existing = new Map((await getRecordingChunks(id)).map((chunk) => [chunk.sequence, chunk]));
  for (let index = 0; index < draft.chunkCount; index += 1) {
    const chunk = await getDiscussionDraftChunk(draft.id, index);
    if (!chunk) throw new Error(`Missing local recording chunk ${index}`);
    if (chunk.blob.size > DISCUSSION_CHUNK_MAX_BYTES) throw new Error('Recording chunk exceeds the supported size');
    const sha256 = await checksum(chunk.blob);
    if (existing.has(index) && existing.get(index)!.sha256 !== sha256) throw new Error('Stored recording differs from this draft');
    if (!existing.has(index)) await uploadRecordingChunk(id, index, chunk.blob, sha256);
    onProgress(Math.round((index + 1) / draft.chunkCount * 100));
  }
  if (complete) {
    const job = await sealRecording(id, { lastSequence: draft.lastSequence, chunkCount: draft.chunkCount, mimeType: draft.mimeType, fileName: draft.fileName ?? `meeting-${draft.startedAt}.${draft.mimeType.includes('mp4') ? 'm4a' : draft.mimeType.includes('ogg') ? 'ogg' : 'webm'}` });
    return waitForRecording(id, job);
  }
}

export async function persistMeetingImport(file: File, id: string): Promise<DiscussionDraft> {
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < file.size * 1.1) throw new Error('Not enough local storage to safely import this recording');
  const mimeType = file.type || (/\.mp3$/i.test(file.name) ? 'audio/mpeg' : /\.wav$/i.test(file.name) ? 'audio/wav' : /\.(m4a|mp4)$/i.test(file.name) ? 'audio/mp4' : /\.ogg$/i.test(file.name) ? 'audio/ogg' : 'audio/webm');
  const draft: DiscussionDraft = { id, mimeType, fileName: file.name, startedAt: Date.now(), updatedAt: Date.now(), durationMs: 1_000, chunkCount: 0, lastSequence: -1, state: 'stopped' };
  try {
  for (let start = 0; start < file.size; start += DISCUSSION_CHUNK_MAX_BYTES) {
    await saveDiscussionDraftChunk({ draftId: id, index: draft.chunkCount, blob: file.slice(start, start + DISCUSSION_CHUNK_MAX_BYTES), createdAt: Date.now() });
    draft.chunkCount += 1;
  }
  await saveDiscussionDraft(draft);
  return draft;
  } catch (error) {
    await deleteDiscussionDraft(id);
    throw error;
  }
}
