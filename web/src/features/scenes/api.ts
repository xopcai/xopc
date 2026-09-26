import type { SceneActivation, SceneTemplate } from '../../../../src/scenes/contracts';
import type { SceneMetrics } from '../../../../src/scenes/metrics';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { SceneActivation, SceneTemplate };
export type SceneMetricsReport = ReturnType<SceneMetrics['forUser']>;
export type SceneOutcome = { id: string; activationId: string; outcomeId: string; status: string;
  readOnly?: boolean; createdAt?: number;
  sources?: Array<{ kind: string; title: string; sender: string; href: string }>;
  sourceHealth?: { reason: string | null; lastSuccessAt: number | null } | null;
  content: { kind: string; summary: string; evidenceIds: string[] } };
export type SceneRun = { id: string; status: string; attempt: number; reason: string | null; createdAt: number };
export type SceneNotes = { content: string; revision: number; validUntil: number | null };

export const sceneGet = <T,>(path: string) => fetchJson<T>(apiUrl(`/api/scenes${path}`));
export const sceneWrite = <T,>(path: string, method: 'POST' | 'PATCH', body?: unknown, requestId?: string) =>
  fetchJson<T>(apiUrl(`/api/scenes${path}`), { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Idempotency-Key': requestId ?? crypto.randomUUID() } });

export function sceneErrorText(error: unknown, zh: boolean): string {
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 401) return zh ? '登录已失效，请重新登录后查看智能关注。' : 'Your session expired. Sign in again to view monitors.';
  if (status === 503) return zh ? '智能关注服务暂不可用，请检查服务状态后重试。' : 'The monitor service is unavailable. Check the Gateway and retry.';
  if (status === 409) return zh ? '内容已被更新，请刷新后重新确认。' : 'This content changed. Refresh and review it before trying again.';
  const missing = (error as { body?: { missing?: string[] } })?.body?.missing;
  if (missing?.some(item => item.startsWith('model_'))) return zh ? '请先在模型设置中选择可用模型并配置凭据，然后重试。' : 'Choose an available model and configure its credentials in model settings, then retry.';
  if (status === 422) return zh ? '设置或授权不完整，请检查数据来源和范围。' : 'Setup or permission is incomplete. Check the source and scope.';
  if (status === 404) return zh ? '找不到这项关注或结果，请返回智能关注列表。' : 'Monitor or result not found. Return to the monitors list.';
  return zh ? '操作未完成，请检查连接后重试。你的输入仍保留在当前页面。' : 'Could not finish. Check your connection and retry. Your input is still on this page.';
}
