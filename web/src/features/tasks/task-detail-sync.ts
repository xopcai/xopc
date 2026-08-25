import type { TaskPatchRequest } from '@xopcai/gateway-contract';

import type { TaskDetail } from '@/features/tasks/home-api';

export type TaskEditBase = { value: string; version: number };

export function hasTaskEditConflict(
  base: TaskEditBase | null,
  currentVersion: number,
  currentValue: string,
  draftValue: string,
): boolean {
  return Boolean(
    base
    && currentVersion !== base.version
    && currentValue !== base.value
    && draftValue !== currentValue,
  );
}

export function optimisticallyPatchTask(
  detail: TaskDetail,
  patch: Omit<TaskPatchRequest, 'expectedVersion'>,
): TaskDetail {
  const task = { ...detail.task };
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.priority !== undefined) task.priority = patch.priority;
  for (const field of [
    'body', 'projectId', 'milestoneId', 'parentTaskId', 'dueAt', 'ownerId',
  ] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null) delete task[field];
    else Object.assign(task, { [field]: value });
  }
  task.version += 1;
  task.updatedAt = Date.now();
  return { ...detail, task };
}
