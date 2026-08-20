import {
  TaskDetailResponseSchema,
  TaskListResponseSchema,
  TaskCreateResponseSchema,
  type TaskCommand,
  type TaskCreateRequest,
  type TaskCreateResponse,
  type TaskListResponse,
} from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';

export type TaskDetail = ReturnType<typeof TaskDetailResponseSchema.parse>;

export type TaskListItem = TaskListResponse['items'][number];

export async function fetchTasks(): Promise<TaskListItem[]> {
  const response = await apiFetch('/api/tasks');
  if (!response.ok) throw new Error(`Failed to fetch tasks: ${response.status}`);
  return TaskListResponseSchema.parse(await response.json()).items;
}

export async function createTask(input: TaskCreateRequest): Promise<TaskCreateResponse> {
  const response = await apiFetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Failed to create task: ${response.status}`);
  }
  return TaskCreateResponseSchema.parse(await response.json());
}

export async function fetchTask(id: string): Promise<TaskDetail> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Failed to fetch task: ${response.status}`);
  return TaskDetailResponseSchema.parse(await response.json());
}

export async function commandTask(
  id: string,
  command: TaskCommand,
  expectedVersion: number,
): Promise<TaskDetail['task']> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedVersion, command }),
  });
  if (!response.ok) throw new Error(`Failed to update task: ${response.status}`);
  const body = await response.json() as { task?: TaskDetail['task'] };
  if (!body.task) throw new Error('Task command returned no task');
  return body.task;
}
