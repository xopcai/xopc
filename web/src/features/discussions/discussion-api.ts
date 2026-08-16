import { fetchJson } from '@/lib/fetch';
import { formatApiHttpError } from '@/lib/http-error-message';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

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

export function finishDiscussion(
  discussionId: string,
  lastSequence: number,
  durationMs: number,
): Promise<DiscussionDetail> {
  return fetchJson(apiUrl(`/api/discussions/${encodeURIComponent(discussionId)}/finish`), {
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

export function uploadDiscussionRecording(
  discussionId: string,
  file: File,
  durationMs: number,
  onProgress: (percent: number) => void,
): Promise<DiscussionDetail> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', apiUrl(`/api/discussions/${encodeURIComponent(discussionId)}/recording`));
    const token = useGatewayStore.getState().token;
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => reject(new Error('Network error while uploading discussion audio'));
    request.onload = () => {
      if (request.status === 401) useGatewayStore.getState().onUnauthorized();
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(request.response as DiscussionDetail);
        return;
      }
      const response = request.response as { error?: string } | null;
      reject(new Error(formatApiHttpError(request.status, request.statusText, response?.error)));
    };
    const form = new FormData();
    form.set('file', file);
    form.set('durationMs', String(Math.round(durationMs)));
    request.send(form);
  });
}
