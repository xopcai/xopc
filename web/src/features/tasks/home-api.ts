import {
  TaskCreateResponseSchema,
  HomeOpportunityActionResponseSchema,
  parseHomeResponse,
  type HomeAttention,
  type HomeDecision,
  type HomeResponse,
  type HomeOpportunity,
  type HomeOpportunityActionRequest,
  type HomeOpportunityActionResponse,
  type HomeOpportunityFeedbackRequest,
  type TaskCommand,
  type TaskCreateRequest,
  type TaskCreateResponse,
  type TaskDetailResponse,
  type TaskPatchRequest,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { readCapability } from '@/lib/capabilities';

export type { HomeAttention, HomeDecision, HomeResponse };
export type TaskDetail = TaskDetailResponse;

export async function createTask(input: TaskCreateRequest): Promise<TaskCreateResponse> {
  return TaskCreateResponseSchema.parse(await fetchJson<unknown>(apiUrl('/api/tasks'), {
    method: 'POST',
    body: JSON.stringify(input),
  }));
}

export async function fetchTask(taskId: string): Promise<TaskDetail> {
  return readCapability('xopc.tasks.get', { id: taskId });
}

export async function ensureTaskConversation(taskId: string): Promise<{
  ok: true;
  conversationId: string;
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
  idempotencyKey: string = crypto.randomUUID(),
): Promise<TaskDetail> {
  await fetchJson(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/commands`), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey, expectedVersion, command }),
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
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ rating, reason: reason?.trim() || undefined }),
  });
}

export function fetchHome(locale?: 'en' | 'zh'): Promise<HomeResponse> {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return fetchJson<unknown>(apiUrl(`/api/home${suffix}`)).then(parseHomeResponse);
}

export function refreshHomeAdvisor(locale?: 'en' | 'zh'): Promise<{ ok: true; generationId: string }> {
  return fetchJson(apiUrl('/api/home/advisor/refresh'), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), locale }),
  });
}

export async function actOnHomeOpportunity(
  opportunity: Pick<HomeOpportunity, 'id' | 'revision'>,
  mode: HomeOpportunityActionRequest['mode'],
): Promise<HomeOpportunityActionResponse> {
  return HomeOpportunityActionResponseSchema.parse(await fetchJson<unknown>(
    apiUrl(`/api/home/opportunities/${encodeURIComponent(opportunity.id)}/action`),
    {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedRevision: opportunity.revision, mode }),
    },
  ));
}

export function submitHomeOpportunityFeedback(
  opportunity: Pick<HomeOpportunity, 'id' | 'revision'>,
  input: Omit<HomeOpportunityFeedbackRequest, 'idempotencyKey' | 'expectedRevision'>,
): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/home/opportunities/${encodeURIComponent(opportunity.id)}/feedback`), {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: opportunity.revision,
    }),
  });
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

export function retryWorkAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; conversationId?: string }> {
  return fetchJson(apiUrl('/api/home/attention/retry'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}
