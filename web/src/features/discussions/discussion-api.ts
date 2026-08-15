import { fetchJson } from '@/lib/fetch';
import { formatApiHttpError } from '@/lib/http-error-message';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import type { DiscussionAnalysis, DiscussionCompletion, DiscussionDetail } from './discussion-types';

export async function createDiscussion(input: {
  clientRequestId: string;
  projectId?: string;
  title?: string;
  language: string;
  captureMode: 'solo' | 'conversation';
  consentConfirmed: boolean;
  source: 'web' | 'electron';
}): Promise<DiscussionDetail> {
  return fetchJson<DiscussionDetail>(apiUrl('/api/discussions'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getDiscussion(id: string): Promise<DiscussionDetail> {
  return fetchJson<DiscussionDetail>(apiUrl(`/api/discussions/${encodeURIComponent(id)}`));
}

export async function saveDiscussionReview(
  id: string,
  analysis: DiscussionAnalysis,
  expectedRevision: number,
): Promise<DiscussionDetail> {
  return fetchJson<DiscussionDetail>(apiUrl(`/api/discussions/${encodeURIComponent(id)}/review`), {
    method: 'PUT',
    body: JSON.stringify({ analysis, expectedRevision }),
  });
}

export async function completeDiscussion(
  id: string,
  expectedRevision: number,
  actionItemIds: string[],
): Promise<DiscussionCompletion> {
  return fetchJson<DiscussionCompletion>(apiUrl(`/api/discussions/${encodeURIComponent(id)}/complete`), {
    method: 'POST',
    body: JSON.stringify({ expectedRevision, actionItemIds }),
  });
}

export async function retryDiscussion(id: string): Promise<DiscussionDetail> {
  return fetchJson<DiscussionDetail>(apiUrl(`/api/discussions/${encodeURIComponent(id)}/retry`), {
    method: 'POST',
  });
}

export async function deleteDiscussionAudio(id: string): Promise<DiscussionDetail> {
  return fetchJson<DiscussionDetail>(apiUrl(`/api/discussions/${encodeURIComponent(id)}/audio`), {
    method: 'DELETE',
  });
}

export function uploadDiscussionAudio(
  discussionId: string,
  file: File,
  durationMs: number,
  onProgress: (percent: number) => void,
): Promise<DiscussionDetail> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', apiUrl(`/api/discussions/${encodeURIComponent(discussionId)}/audio`));
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
