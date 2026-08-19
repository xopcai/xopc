import type {
  TaskAction,
  TaskPriority,
  TaskStatus,
  ProjectTaskCard,
  ProjectTaskLane,
} from '@xopcai/gateway-contract';

import type { TaskAggregate } from './task-repository.js';

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function projectTaskLane(status: TaskStatus): ProjectTaskLane | undefined {
  if (status === 'pending' || status === 'waiting_dependency' || status === 'paused') return 'ready';
  if (status === 'planning' || status === 'running' || status === 'verifying') {
    return 'moving';
  }
  if (status === 'needs_user' || status === 'blocked') return 'needs_user';
  if (status === 'completed') return 'done';
  return undefined;
}

export function allowedTaskActions(status: TaskStatus): TaskAction[] {
  if (status === 'pending') return ['run', 'cancel'];
  if (status === 'waiting_dependency') return ['cancel'];
  if (status === 'paused' || status === 'needs_user' || status === 'blocked') return ['resume', 'verify', 'cancel'];
  if (status === 'planning' || status === 'running' || status === 'verifying') {
    return ['pause', 'verify', 'cancel'];
  }
  return [];
}

export function projectTaskCard(task: TaskAggregate): ProjectTaskCard | undefined {
  const lane = projectTaskLane(task.status);
  if (!lane) return undefined;
  const execution = task.execution;
  return {
    id: task.id,
    title: task.objective,
    lane,
    status: task.status,
    priority: task.priority,
    ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt }),
    ...(execution.nextAction ? { nextAction: execution.nextAction } : {}),
    ...(execution.blockedReason ? { blockedReason: execution.blockedReason } : {}),
    ...(execution.activeSessionKey ? { activeSessionKey: execution.activeSessionKey } : {}),
    acceptanceCriteriaCount: task.contract?.acceptanceCriteria.length ?? 0,
    blockedBy: [],
    allowedActions: allowedTaskActions(task.status),
    updatedAt: task.updatedAt,
  };
}

export function compareProjectTaskCards(a: ProjectTaskCard, b: ProjectTaskCard): number {
  const priority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  if (priority !== 0) return priority;
  const dueAt = (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY);
  if (dueAt !== 0) return dueAt;
  return b.updatedAt - a.updatedAt;
}
