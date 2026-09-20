import type { SceneActivation, SceneTemplate } from '../../../../src/scenes/contracts';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { SceneActivation, SceneTemplate };
export type SceneOutcome = { id: string; activationId: string; outcomeId: string; status: string;
  content: { kind: string; summary: string; evidenceIds: string[] } };
export type SceneRun = { id: string; status: string; attempt: number; reason: string | null; createdAt: number };
export type SceneNotes = { content: string; revision: number; validUntil: number | null };

export const sceneGet = <T,>(path: string) => fetchJson<T>(apiUrl(`/api/scenes${path}`));
export const sceneWrite = <T,>(path: string, method: 'POST' | 'PATCH', body?: unknown, requestId?: string) =>
  fetchJson<T>(apiUrl(`/api/scenes${path}`), { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: requestId ? { 'Idempotency-Key': requestId } : undefined });

export function sceneErrorText(error: unknown, zh: boolean): string {
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 401) return zh ? '登录已失效，请重新登录后查看场景。' : 'Your session expired. Sign in again to view scenes.';
  if (status === 503) return zh ? '场景服务尚未启用。完成数据切换后可使用。' : 'Scenes are not enabled yet. Complete the data cutover to use them.';
  if (status === 409) return zh ? '内容已被更新，请刷新后重新确认。' : 'This content changed. Refresh and review it before trying again.';
  if (status === 422) return zh ? '设置或授权不完整，请检查数据来源和范围。' : 'Setup or permission is incomplete. Check the source and scope.';
  if (status === 404) return zh ? '找不到这个场景或结果，请返回场景列表。' : 'Scene or result not found. Return to the scenes list.';
  return zh ? '操作未完成，请检查连接后重试。你的输入仍保留在当前页面。' : 'Could not finish. Check your connection and retry. Your input is still on this page.';
}
