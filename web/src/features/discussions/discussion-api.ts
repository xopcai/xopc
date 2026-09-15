import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  DiscussionCaptureSettings,
  DiscussionDetail,
  DiscussionTranscript,
} from './discussion-types';

export function getDiscussionCaptureSettings(): Promise<DiscussionCaptureSettings> {
  return fetchJson(apiUrl('/api/discussion-capture/settings'));
}

export function acknowledgeDiscussionConsent(consentPolicyVersion: number): Promise<DiscussionCaptureSettings> {
  return fetchJson(apiUrl('/api/discussion-capture/settings'), {
    method: 'PUT',
    body: JSON.stringify({ consentPolicyVersion }),
  });
}

export async function createDiscussion(input: {
  clientRequestId: string;
  contextProjectId?: string;
  consentPolicyVersion: number;
  source: 'web' | 'electron';
}): Promise<DiscussionDetail> {
  return fetchJson<DiscussionDetail>(apiUrl('/api/discussions'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getDiscussion(id: string): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}`));
}

export async function getDiscussionForNote(noteId: string): Promise<DiscussionDetail | null> {
  try {
    return await fetchJson(apiUrl(`/api/discussions/by-note/${encodeURIComponent(noteId)}`));
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

export function getDiscussionTranscript(id: string): Promise<DiscussionTranscript> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/transcript`));
}

export function uploadDiscussionSegment(
  discussionId: string,
  sequence: number,
  input: { blob: Blob; startedAtMs: number; endedAtMs: number; sha256: string },
): Promise<DiscussionTranscript> {
  const form = new FormData();
  form.set('file', input.blob, `segment-${sequence}.wav`);
  form.set('startedAtMs', String(input.startedAtMs));
  form.set('endedAtMs', String(input.endedAtMs));
  form.set('sha256', input.sha256);
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(discussionId)}/segments/${sequence}`), {
    method: 'PUT',
    body: form,
  });
}

export function stopDiscussion(
  discussionId: string,
  lastSequence: number,
  durationMs: number,
): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(discussionId)}/stop`), {
    method: 'POST',
    body: JSON.stringify({ lastSequence, durationMs }),
  });
}

export function retryDiscussion(id: string): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/retry`), { method: 'POST' });
}

export function cancelDiscussion(id: string): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/cancel`), { method: 'POST' });
}

export function deleteDiscussionAudio(id: string): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/audio`), { method: 'DELETE' });
}

export function unlinkDiscussionProject(id: string): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/project`), { method: 'DELETE' });
}

export function getRecordingChunks(id: string): Promise<Array<{ sequence: number; sha256: string; bytes: number }>> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/recording/chunks`));
}

export function uploadRecordingChunk(id: string, sequence: number, blob: Blob, sha256: string): Promise<unknown> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/recording/chunks/${sequence}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-audio-sha256': sha256 }, body: blob,
  });
}

export function completeRecording(id: string, input: { chunkCount: number; mimeType: string; fileName: string }): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(id)}/recording/complete`), { method: 'POST', body: JSON.stringify(input) });
}
