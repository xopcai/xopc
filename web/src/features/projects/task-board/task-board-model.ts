import type { TaskAction, ProjectTaskCard, ProjectTaskLane } from '@xopcai/gateway-contract';

export const PROJECT_TASK_LANES: ProjectTaskLane[] = ['ready', 'moving', 'needs_user', 'done'];

export function groupProjectTasks(
  tasks: ProjectTaskCard[],
): Record<ProjectTaskLane, ProjectTaskCard[]> {
  return {
    ready: tasks.filter((task) => task.lane === 'ready'),
    moving: tasks.filter((task) => task.lane === 'moving'),
    needs_user: tasks.filter((task) => task.lane === 'needs_user'),
    done: tasks.filter((task) => task.lane === 'done'),
  };
}

export function taskActionForLane(
  task: ProjectTaskCard,
  targetLane: ProjectTaskLane,
): TaskAction | undefined {
  if (targetLane === 'ready' && task.allowedActions.includes('pause')) return 'pause';
  if (targetLane === 'moving' && task.allowedActions.includes('run')) return 'run';
  if (targetLane === 'moving' && task.allowedActions.includes('resume')) return 'resume';
  if (targetLane === 'done' && task.allowedActions.includes('verify')) return 'verify';
  return undefined;
}

export function primaryTaskAction(task: ProjectTaskCard): TaskAction | undefined {
  return task.allowedActions.find((action) => action !== 'cancel');
}
