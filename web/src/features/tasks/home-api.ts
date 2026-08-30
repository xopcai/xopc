import {
  TaskCreateResponseSchema,
  TaskDetailResponseSchema,
  parseHomeResponse,
  type HomeAttention,
  type HomeDecision,
  type HomeResponse,
  type TaskCommand,
  type TaskCreateRequest,
  type TaskCreateResponse,
  type TaskDetailResponse,
  type TaskPatchRequest,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { HomeAttention, HomeDecision, HomeResponse };
export type TaskDetail = TaskDetailResponse;

export async function createTask(input: TaskCreateRequest): Promise<TaskCreateResponse> {
  return TaskCreateResponseSchema.parse(await fetchJson<unknown>(apiUrl('/api/tasks'), {
    method: 'POST',
    body: JSON.stringify(input),
  }));
}

export async function fetchTask(taskId: string): Promise<TaskDetail> {
  return TaskDetailResponseSchema.parse(await fetchJson<unknown>(
    apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`),
  ));
}

export async function ensureTaskConversation(taskId: string): Promise<{
  ok: true;
  sessionKey: string;
  agentId: string;
  created: boolean;
}> {
  return fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/conversation`), {
    method: 'POST',
  });
}

export async function updateTask(
  taskId: string,
  patch: Omit<TaskPatchRequest, 'expectedVersion'>,
  expectedVersion: number,
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`), {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, expectedVersion }),
  });
  return fetchTask(taskId);
}

export async function deleteTask(taskId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`), { method: 'DELETE' });
}

export async function commandTask(
  taskId: string,
  command: TaskCommand,
  expectedVersion: number,
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/commands`), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedVersion, command }),
  });
  return fetchTask(taskId);
}

export async function cancelTaskRun(
  taskId: string,
  runId: string,
  expectedVersion: number,
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/task-runs/${encodeURIComponent(runId)}/cancel`), {
    method: 'POST',
    body: JSON.stringify({ expectedVersion, reason: 'Cancelled by user' }),
  });
  return fetchTask(taskId);
}

export async function handoffTask(
  taskId: string,
  toAgentId: string,
  expectedVersion: number,
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/handoff`), {
    method: 'POST',
    body: JSON.stringify({
      toAgentId,
      expectedVersion,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  return fetchTask(taskId);
}

export async function updateTaskDependencies(
  taskId: string,
  dependsOnTaskIds: string[],
  expectedVersion: number,
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`), {
    method: 'PUT',
    body: JSON.stringify({ dependsOnTaskIds, expectedVersion }),
  });
  return fetchTask(taskId);
}

export async function updateTaskBoardPosition(
  taskId: string,
  beforeTaskId: string | null,
  expectedVersion: number,
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/board-position`), {
    method: 'PUT',
    body: JSON.stringify({ beforeTaskId, expectedVersion }),
  });
  return fetchTask(taskId);
}

export async function submitTaskFeedback(
  runId: string,
  rating: 'helpful' | 'not_helpful',
  reason?: string,
): Promise<void> {
  await fetchJson(apiUrl(`/api/task-runs/${encodeURIComponent(runId)}/feedback`), {
    method: 'POST',
    body: JSON.stringify({ rating, reason: reason?.trim() || undefined }),
  });
}

export function fetchHome(locale?: 'en' | 'zh'): Promise<HomeResponse> {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return fetchJson<unknown>(apiUrl(`/api/home${suffix}`)).then(parseHomeResponse);
}

export function respondToWorkDecision(
  response: NonNullable<HomeDecision['response']>,
  decision: 'approve' | 'deny',
): Promise<{ ok: true; status: string }> {
  return fetchJson(apiUrl('/api/home/decisions/respond'), {
    method: 'POST',
    body: JSON.stringify({ ...response, decision }),
  });
}

export function acknowledgeWorkAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; status: 'acknowledged' }> {
  return fetchJson(apiUrl('/api/home/attention/acknowledge'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export function decideAgentJudgment(itemId: string, choice: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/decisions`), {
    method: 'POST',
    body: JSON.stringify({ choice }),
  });
}

export function transitionAgentJudgment(itemId: string, status: 'read' | 'snoozed' | 'resolved'): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/transition`), {
    method: 'POST',
    body: JSON.stringify(status === 'snoozed'
      ? { status, snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      : status === 'resolved' ? { status, resolution: 'dismissed' } : { status }),
  });
}

export function instructAgentJudgment(itemId: string, instruction: string): Promise<{ ok: true; revisionId: string }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/instructions`), {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });
}

export function retryWorkAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; sessionKey?: string }> {
  return fetchJson(apiUrl('/api/home/attention/retry'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}
