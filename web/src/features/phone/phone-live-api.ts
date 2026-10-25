import useSWR from 'swr';

import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type PhoneAction = { type: 'tap' | 'longPress'; point: number[]; durationMs?: number }
  | { type: 'swipe'; start: number[]; end: number[]; durationMs: number }
  | { type: 'launch'; package: string } | { type: 'back' } | { type: 'typeText'; text: string };
export type PhoneLiveState = {
  report: { sessionId: string; deviceId?: string; owner?: string; deviceName: string; agentId: string; modelRef: string; status: string; mode: string;
    executionMode?: 'collaborative' | 'direct'; nextExecutionMode?: 'collaborative' | 'direct'; task?: { taskId: string };
    feedback?: { outcome: string; nextAction: string };
    controlOwner?: 'agent' | 'human' | 'none'; controlEpoch?: number; handoff?: string; message?: string; stopReason?: string;
    currentAction?: string; goalPreview?: string; sourceConversationId?: string; actions: number; modelRequests: number; updatedAt: number };
  ownControl: boolean; appAccess?: 'all' | 'selected'; textInput?: 'auto' | 'manual'; allowedApps?: string[]; frame: { seq: number; capturedAt: number } | null;
};
export const phoneClientId = crypto.randomUUID();
export const phoneEnded = (status: string) => status === 'closed';
export function phoneErrorMessage(error: unknown, zh: boolean): string {
  const value = error as { code?: string; body?: { error?: { code?: string } }; message?: string };
  const code = value?.code ?? value?.body?.error?.code;
  const messages: Record<string, string> = {
    PHONE_DEVICE_BUSY: '手机正被其他聊天或人工操作占用，本次操作尚未开始。请查看当前任务，等待或明确停止后再试。',
    PHONE_OBSERVE_ONLY: '此入口仅支持查看手机画面，请在来源聊天中操作或接管手机。',
    PHONE_CONTROL_CHANGED: '手机控制权已变化，本次操作未继续。请查看最新状态后重新接管。',
    PHONE_CONTROL_REQUIRED: '当前窗口没有手机操作权，请先接管手机。',
    PHONE_CONTROL_STALE: '手机控制状态已更新，请等待状态刷新后再操作。',
    PHONE_DISPATCH_UNKNOWN: '上一条手机输入的结果尚未确认，请先检查手机，避免重复执行。',
    PHONE_FRAME_STALE: '手机画面已变化，请等待新画面后再操作。',
    PHONE_APP_DENIED: '当前页面不在授权应用范围内，请返回授权应用。',
    PHONE_SESSION_NOT_FOUND: '手机连接或来源聊天已变化，请刷新手机面板。',
    PHONE_PAUSED: '手机任务已暂停，请检查手机状态并明确交回控制权后继续。',
  };
  return zh && code && messages[code] ? messages[code] : value?.message ?? (zh ? '无法完成手机操作，请检查连接状态。' : 'Phone operation failed. Check the connection.');
}
const base = (conversationId: string) => `/api/phone/conversations/${encodeURIComponent(conversationId)}`;
export async function fetchConversationPhone(url: string): Promise<PhoneLiveState | null> {
  const response = await apiFetch(apiUrl(url));
  // Draft conversations materialize on the server only when the first input arrives.
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error(`Phone view unavailable (HTTP ${response.status})`), { status: response.status });
  return ((await response.json()) as { payload: PhoneLiveState | null }).payload;
}
export function useConversationPhone(conversationId: string, enabled = true) {
  return useSWR(enabled && /^(?:device:)?[\da-f]{8}-[\da-f-]{27}$/i.test(conversationId) ? `${base(conversationId)}?clientId=${phoneClientId}` : null,
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

export async function setPhoneExecutionMode(conversationId: string, state: PhoneLiveState, executionMode: 'collaborative' | 'direct', applyCurrent = false) {
  const response = await fetchJson<{ payload: PhoneLiveState }>(apiUrl(`${base(conversationId)}/${state.report.sessionId}/execution-mode`), {
    method: 'POST', body: JSON.stringify({ executionMode, applyCurrent, epoch: state.report.controlEpoch, clientId: phoneClientId }),
  });
  return response.payload;
}
