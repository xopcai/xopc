import type { ProjectTaskCard, ProjectTaskLane } from '@xopcai/gateway-contract';

export type TaskBoardAction = 'run' | 'resume' | 'pause' | 'verify';

export const PROJECT_TASK_LANES: ProjectTaskLane[] = ['ready', 'moving', 'waiting', 'needs_user', 'done'];

export function groupProjectTasks(
  tasks: ProjectTaskCard[],
): Record<ProjectTaskLane, ProjectTaskCard[]> {
  return {
    ready: tasks.filter((task) => task.lane === 'ready'),
    moving: tasks.filter((task) => task.lane === 'moving'),
    waiting: tasks.filter((task) => task.lane === 'waiting'),
    needs_user: tasks.filter((task) => task.lane === 'needs_user'),
    done: tasks.filter((task) => task.lane === 'done'),
  };
}

export function taskActionForLane(
  task: ProjectTaskCard,
  targetLane: ProjectTaskLane,
): TaskBoardAction | undefined {
  if (targetLane === 'ready' && task.allowedCommands.includes('add_wait')) return 'pause';
  if (targetLane === 'moving' && task.allowedCommands.includes('start')) return 'run';
  if (targetLane === 'moving' && task.allowedCommands.includes('resolve_wait')) return 'resume';
  if (targetLane === 'done' && task.allowedCommands.includes('request_review')) return 'verify';
  return undefined;
}

export function primaryTaskAction(task: ProjectTaskCard): TaskBoardAction | undefined {
  if (task.allowedCommands.includes('start')) return 'run';
  if (task.allowedCommands.includes('resolve_wait')) return 'resume';
  if (task.allowedCommands.includes('request_review')) return 'verify';
  if (task.allowedCommands.includes('add_wait')) return 'pause';
  return undefined;
}
