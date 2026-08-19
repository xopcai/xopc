import {
  TaskDetailResponseSchema,
  TaskCreateResponseSchema,
  TaskReceiptSchema,
  TaskSchema,
  parseHomeResponse,
  type Task,
  type TaskAction,
  type TaskContextManifest,
  type TaskDependencySummary,
  type TaskCreateRequest,
  type TaskCreateResponse,
  type TaskExecutionSummary,
  type TaskProgress,
  type TaskAttention,
  type TaskReceipt,
  type HomeAttention,
  type HomeChat,
  type HomeDecision,
  type HomeResponse,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { HomeAttention, HomeChat, HomeDecision, HomeResponse };

export async function createTask(input: TaskCreateRequest): Promise<TaskCreateResponse> {
  return TaskCreateResponseSchema.parse(await fetchJson<unknown>(apiUrl('/api/tasks'), {
    method: 'POST',
    body: JSON.stringify(input),
  }));
}

export type TaskDetail = {
  task: Task;
  receipts: TaskReceipt[];
  execution?: TaskExecutionSummary;
  progress?: TaskProgress;
  attention?: TaskAttention;
  nextCheckAt?: number;
  contextManifest?: TaskContextManifest;
  dependencies: TaskDependencySummary[];
  dependents: TaskDependencySummary[];
};

export async function fetchTask(taskId: string): Promise<TaskDetail> {
  const response = TaskDetailResponseSchema.parse(await fetchJson<unknown>(
    apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`),
  ));
  return {
    task: response.task,
    receipts: response.receipts,
    execution: response.execution,
    progress: response.progress,
    attention: response.attention,
    nextCheckAt: response.nextCheckAt,
    contextManifest: response.contextManifest,
    dependencies: response.dependencies,
    dependents: response.dependents,
  };
}

export async function actOnTask(
  taskId: string,
  action: TaskAction,
  expectedUpdatedAt: number,
  approvedBoundaries?: string[],
): Promise<Task> {
  const response = await fetchJson<{ task?: unknown }>(
    apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/actions`),
    { method: 'POST', body: JSON.stringify({ action, expectedUpdatedAt, approvedBoundaries }) },
  );
  return TaskSchema.parse(response.task);
}

export async function submitTaskFeedback(
  runId: string,
  rating: 'helpful' | 'not_helpful',
  reason?: string,
): Promise<TaskReceipt> {
  const response = await fetchJson<{ receipt?: unknown }>(
    apiUrl(`/api/execution-receipts/${encodeURIComponent(runId)}/feedback`),
    {
      method: 'POST',
      body: JSON.stringify({ rating, reason: reason?.trim() || undefined }),
    },
  );
  return TaskReceiptSchema.parse(response.receipt);
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
    method: 'POST', body: JSON.stringify({ choice }),
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
    method: 'POST', body: JSON.stringify({ instruction }),
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
