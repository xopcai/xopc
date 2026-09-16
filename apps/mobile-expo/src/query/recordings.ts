import { queryOptions } from '@tanstack/react-query';

import type { DiscussionCapture, DiscussionCaptureSettings, DiscussionOrganizationRecord, DiscussionRecordingChunk, DiscussionRecordingJob, DiscussionTranscript } from '@xopcai/gateway-contract';

import { apiFetch, apiUploadFile } from '../api/client';
import { useGatewayStore } from '../stores/gateway-store';
import { recordingChunks, saveRecording, useRecordings, type LocalRecording } from '../features/recordings/recordings';

export type RecordingDetail = { discussion: DiscussionCapture; transcript: DiscussionTranscript; organization?: DiscussionOrganizationRecord; recordingJob?: DiscussionRecordingJob };

async function json<T>(path: string, init?: Parameters<typeof apiFetch>[1]): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json() as Promise<T>;
}

export function assertRecordingBinding(item: Pick<LocalRecording, 'binding'>): void {
  const profile = useGatewayStore.getState().getActiveProfile();
  if (!profile || !item.binding || profile.gatewayId !== item.binding.gatewayId || profile.deviceId !== item.binding.deviceId
    || profile.gatewayPublicKey !== item.binding.publicKey) throw new Error('RECORDING_WORKSPACE_CHANGED');
}

const uploads = new Map<string, Promise<void>>();
export function uploadRecording(item: LocalRecording, progress: (done: number, total: number) => void): Promise<void> {
  const existing = uploads.get(item.id);
  if (existing) return existing;
  const work = performUpload(item, progress).finally(() => uploads.delete(item.id));
  uploads.set(item.id, work);
  return work;
}

async function performUpload(input: LocalRecording, progress: (done: number, total: number) => void): Promise<void> {
  let item = useRecordings.getState().items.find(row => row.id === input.id) ?? input;
  if (item.state !== 'saved') throw new Error('RECORDING_NOT_FINISHED');
  const profile = useGatewayStore.getState().getActiveProfile();
  if (!item.binding && profile) {
    item = { ...item, binding: { gatewayId: profile.gatewayId, deviceId: profile.deviceId, publicKey: profile.gatewayPublicKey } };
    saveRecording(item);
  }
  assertRecordingBinding(item);
  const chunks = await recordingChunks(item);
  if (!chunks.length) throw new Error('RECORDING_EMPTY');
  assertRecordingBinding(item);
  const settings = await json<DiscussionCaptureSettings>('/api/discussion-capture/settings');
  assertRecordingBinding(item);
  await json('/api/discussion-capture/settings', { method: 'PUT', body: JSON.stringify({ consentPolicyVersion: settings.consentPolicyVersion }) });
  assertRecordingBinding(item);
  if (!item.discussionId) {
    const detail = await json<RecordingDetail>('/api/discussions', { method: 'POST', body: JSON.stringify({
      clientRequestId: `mobile:${item.binding!.deviceId}:${item.id}`, source: 'mobile', recordedAt: item.recordedAt, consentPolicyVersion: settings.consentPolicyVersion,
    }) });
    assertRecordingBinding(item);
    item = { ...item, discussionId: detail.discussion.id, noteId: detail.discussion.noteId };
    saveRecording(item);
  }
  assertRecordingBinding(item);
  const path = `/api/discussions/${encodeURIComponent(item.discussionId!)}`;
  const current = await json<RecordingDetail>(path);
  assertRecordingBinding(item);
  if (current.discussion.audioAttachmentId && current.recordingJob?.state === 'completed') return;
  if (current.recordingJob && ['queued', 'running'].includes(current.recordingJob.state)) return;
  assertRecordingBinding(item);
  const received = await json<DiscussionRecordingChunk[]>(`${path}/recording/chunks`);
  let done = 0;
  for (const chunk of chunks) {
    assertRecordingBinding(item);
    const receipt = received.find(row => row.sequence === chunk.sequence);
    if (receipt && (receipt.sha256 !== chunk.sha256 || receipt.bytes !== chunk.bytes)) throw new Error('RECORDING_CHUNK_CONFLICT');
    if (!receipt) {
      const response = await apiUploadFile(`${path}/recording/chunks/${chunk.sequence}`, {
        method: 'PUT', binary: true, uri: chunk.uri, fieldName: 'file', mimeType: 'audio/wav',
        headers: { 'x-audio-sha256': chunk.sha256, 'Content-Type': 'audio/wav' }, timeoutMs: 60_000,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    progress(++done, chunks.length);
  }
  assertRecordingBinding(item);
  await json(`${path}/capture/seal`, { method: 'POST', body: JSON.stringify({
    chunkCount: chunks.length, mimeType: 'audio/wav', fileName: 'recording.wav', lastSequence: -1, containerMode: 'independent_wav',
  }) });
}

export function recordingDetailOptions(item?: LocalRecording) {
  return queryOptions({
    queryKey: ['recording-detail', item?.binding?.gatewayId, item?.binding?.deviceId, item?.discussionId],
    enabled: !!item?.discussionId,
    queryFn: () => { assertRecordingBinding(item!); return json<RecordingDetail>(`/api/discussions/${encodeURIComponent(item!.discussionId!)}`); },
    refetchInterval: query => {
      const detail = query.state.data;
      return detail && ['completed', 'cancelled', 'needs_attention'].includes(detail.discussion.status) ? false : 3000;
    },
    retry: false as const,
  });
}

export async function retryRecording(item: LocalRecording): Promise<void> {
  assertRecordingBinding(item);
  await json(`/api/discussions/${encodeURIComponent(item.discussionId!)}/retry`, { method: 'POST' });
}

/** Meeting content is stored separately from the user's editable note markdown. */
export function recordingNoteOptions(noteId: string, binding: LocalRecording['binding']) {
  return queryOptions({
    queryKey: ['recording-note', binding?.gatewayId, binding?.deviceId, binding?.publicKey, noteId],
    enabled: !!noteId && !!binding,
    queryFn: async (): Promise<RecordingDetail | null> => {
      const owner = { binding };
      assertRecordingBinding(owner);
      const response = await apiFetch(`/api/discussions/by-note/${encodeURIComponent(noteId)}`);
      assertRecordingBinding(owner);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const detail = await response.json() as RecordingDetail;
      assertRecordingBinding(owner);
      return detail;
    },
    refetchInterval: query => {
      const detail = query.state.data;
      return detail && !['completed', 'cancelled', 'needs_attention'].includes(detail.discussion.status) ? 3000 : false;
    },
    retry: false as const,
  });
}
