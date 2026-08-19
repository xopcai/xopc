import {
  TaskDetailResponseSchema,
  TaskListResponseSchema,
  TaskSchema,
  TaskCreateResponseSchema,
  type Task,
  type TaskAction,
  type TaskCreateRequest,
  type TaskCreateResponse,
} from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';

export type TaskDetail = ReturnType<typeof TaskDetailResponseSchema.parse>;

export async function fetchTasks(): Promise<Task[]> {
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

export async function actOnTask(
  id: string,
  action: TaskAction,
  expectedUpdatedAt: number,
  approvedBoundaries?: string[],
): Promise<Task> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, expectedUpdatedAt, approvedBoundaries }),
  });
  if (!response.ok) throw new Error(`Failed to update task: ${response.status}`);
  const body = await response.json() as { task?: unknown };
  return TaskSchema.parse(body.task);
}
