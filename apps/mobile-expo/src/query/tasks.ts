import {
  TaskDetailResponseSchema,
  TaskListResponseSchema,
  TaskCreateResponseSchema,
  type TaskCommand,
  type TaskCreateRequest,
  type TaskCreateResponse,
  type TaskListResponse,
} from '@xopcai/gateway-contract';
import { randomUUID } from 'expo-crypto';

import { apiFetch } from '../api/client';

export class TaskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'TaskApiError';
  }
}

async function taskError(response: Response, fallback: string): Promise<TaskApiError> {
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
  return new TaskApiError(body.error || fallback, response.status, body.code);
}

export type TaskDetail = ReturnType<typeof TaskDetailResponseSchema.parse>;

export type TaskListItem = TaskListResponse['items'][number];

export async function fetchTasks(): Promise<TaskListItem[]> {
  const response = await apiFetch('/api/tasks');
  if (!response.ok) throw await taskError(response, `Failed to fetch tasks: ${response.status}`);
  return TaskListResponseSchema.parse(await response.json()).items;
}

export async function createTask(input: TaskCreateRequest): Promise<TaskCreateResponse> {
  const response = await apiFetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await taskError(response, `Failed to create task: ${response.status}`);
  }
  return TaskCreateResponseSchema.parse(await response.json());
}

export async function fetchTask(id: string): Promise<TaskDetail> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}`);
  if (!response.ok) throw await taskError(response, `Failed to fetch task: ${response.status}`);
  return TaskDetailResponseSchema.parse(await response.json());
}

export type EnsuredTaskConversation = {
  ok: true;
  sessionKey: string;
  agentId: string;
  created: boolean;
};

export async function ensureTaskConversation(id: string): Promise<EnsuredTaskConversation> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/conversation`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await taskError(response, `Failed to create task conversation: ${response.status}`);
  }
  const body = await response.json() as Partial<EnsuredTaskConversation>;
  if (body.ok !== true || typeof body.sessionKey !== 'string' || typeof body.agentId !== 'string') {
    throw new Error('Task conversation response was invalid');
  }
  return {
    ok: true,
    sessionKey: body.sessionKey,
    agentId: body.agentId,
    created: body.created === true,
  };
}

export async function handoffTaskConversation(
  id: string,
  toAgentId: string,
  expectedVersion: number,
): Promise<{ activeSessionKey: string; toAgentId: string }> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/handoff`, {
    method: 'POST',
    body: JSON.stringify({
      toAgentId,
      expectedVersion,
      idempotencyKey: randomUUID(),
    }),
  });
  if (!response.ok) throw await taskError(response, `Failed to hand off task: ${response.status}`);
  const body = await response.json() as { activeSessionKey?: unknown; toAgentId?: unknown };
  if (typeof body.activeSessionKey !== 'string' || typeof body.toAgentId !== 'string') {
    throw new Error('Task handoff response was invalid');
  }
  return { activeSessionKey: body.activeSessionKey, toAgentId: body.toAgentId };
}

export async function commandTask(
  id: string,
  command: TaskCommand,
  expectedVersion: number,
): Promise<TaskDetail['task']> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: randomUUID(), expectedVersion, command }),
  });
  if (!response.ok) throw await taskError(response, `Failed to update task: ${response.status}`);
  const body = await response.json() as { task?: TaskDetail['task'] };
  if (!body.task) throw new Error('Task command returned no task');
  return body.task;
}
