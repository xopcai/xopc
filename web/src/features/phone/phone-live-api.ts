import useSWR from 'swr';

import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type PhoneAction = { type: 'tap' | 'longPress'; point: number[]; durationMs?: number }
  | { type: 'swipe'; start: number[]; end: number[]; durationMs: number }
  | { type: 'launch'; package: string } | { type: 'back' } | { type: 'typeText'; text: string };
export type PhoneLiveState = {
  report: { sessionId: string; deviceName: string; agentId: string; modelRef: string; status: string; mode: string;
    controlOwner?: 'agent' | 'human' | 'none'; controlEpoch?: number; handoff?: string; message?: string; stopReason?: string;
    currentAction?: string; actions: number; modelRequests: number; updatedAt: number };
  ownControl: boolean; appAccess?: 'all' | 'selected'; textInput?: 'auto' | 'manual'; allowedApps?: string[]; frame: { seq: number; capturedAt: number } | null;
};
export const phoneClientId = crypto.randomUUID();
export const phoneEnded = (status: string) => ['closed', 'cancelled', 'failed', 'outcome_unknown'].includes(status);
const base = (conversationId: string) => `/api/phone/conversations/${encodeURIComponent(conversationId)}`;
export async function fetchConversationPhone(url: string): Promise<PhoneLiveState | null> {
  const response = await apiFetch(apiUrl(url));
  // Draft conversations materialize on the server only when the first input arrives.
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error(`Phone view unavailable (HTTP ${response.status})`), { status: response.status });
  return ((await response.json()) as { payload: PhoneLiveState | null }).payload;
}
export function useConversationPhone(conversationId: string, enabled = true) {
  return useSWR(enabled && /^[\da-f]{8}-[\da-f-]{27}$/i.test(conversationId) ? `${base(conversationId)}?clientId=${phoneClientId}` : null,
    fetchConversationPhone,
    { refreshInterval: 1200, revalidateOnFocus: true, shouldRetryOnError: (error: { status?: number }) => error.status !== 401 && error.status !== 403, errorRetryCount: 6, errorRetryInterval: 2000, refreshWhenHidden: false });
}
export async function controlPhone(conversationId: string, state: PhoneLiveState, op: string, extra: { action?: PhoneAction; frameSeq?: number; geometry?: number } = {}, keepalive = false) {
  const response = await fetchJson<{ payload: PhoneLiveState }>(apiUrl(`${base(conversationId)}/${state.report.sessionId}/control`), {
    method: 'POST', keepalive, body: JSON.stringify({ clientId: phoneClientId, operationId: crypto.randomUUID(), epoch: state.report.controlEpoch, op, ...extra }),
  });
  return response.payload;
}
export async function phoneFrame(conversationId: string, sessionId: string, signal: AbortSignal) {
  const response = await apiFetch(apiUrl(`${base(conversationId)}/${sessionId}/frame`), { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error?.message ?? `HTTP ${response.status}`), { status: response.status, code: body.error?.code });
  }
  return { blob: await response.blob(), seq: Number(response.headers.get('X-Phone-Frame-Seq')), capturedAt: Number(response.headers.get('X-Phone-Captured-At')),
    width: Number(response.headers.get('X-Phone-Width')), height: Number(response.headers.get('X-Phone-Height')) };
}

/** Coordinates are relative to the actual image, excluding contain letterboxes. */
export function phonePoint(rect: { left: number; top: number; width: number; height: number }, width: number, height: number, x: number, y: number): number[] | null {
  const scale = Math.min(rect.width / width, rect.height / height);
  const w = width * scale; const h = height * scale;
  const px = x - rect.left - (rect.width - w) / 2; const py = y - rect.top - (rect.height - h) / 2;
  if (!scale || px < 0 || py < 0 || px > w || py > h) return null;
  return [Math.round(px / w * 1000), Math.round(py / h * 1000)];
}
