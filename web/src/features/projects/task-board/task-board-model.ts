import type { ProjectTaskCard, TaskPhase } from '@xopcai/gateway-contract';

export type TaskBoardAction =
  | 'ready'
  | 'run'
  | 'resume'
  | 'pause'
  | 'review'
  | 'complete'
  | 'reopen';

export const PROJECT_TASK_PHASES: TaskPhase[] = ['backlog', 'ready', 'active', 'review', 'closed'];

export function groupProjectTasks(
  tasks: ProjectTaskCard[],
): Record<TaskPhase, ProjectTaskCard[]> {
  return {
    backlog: tasks.filter((task) => task.phase === 'backlog'),
    ready: tasks.filter((task) => task.phase === 'ready'),
    active: tasks.filter((task) => task.phase === 'active'),
    review: tasks.filter((task) => task.phase === 'review'),
    closed: tasks.filter((task) => task.phase === 'closed'),
  };
}

export function taskActionForPhase(
  task: ProjectTaskCard,
  targetPhase: TaskPhase,
): TaskBoardAction | undefined {
  if (task.phase === targetPhase) return undefined;
  if (targetPhase === 'ready' && task.phase === 'backlog' && task.allowedCommands.includes('mark_ready')) return 'ready';
  if (targetPhase === 'ready' && task.phase === 'closed' && task.allowedCommands.includes('reopen')) return 'reopen';
  if (targetPhase === 'active' && task.allowedCommands.includes('start')) return 'run';
  if (targetPhase === 'review' && task.allowedCommands.includes('request_review')) return 'review';
  if (targetPhase === 'closed' && task.phase === 'review' && task.allowedCommands.includes('close')) return 'complete';
  return undefined;
}

export function canDragTask(task: ProjectTaskCard): boolean {
  return PROJECT_TASK_PHASES.some((phase) => taskActionForPhase(task, phase));
}

export function primaryTaskAction(task: ProjectTaskCard): TaskBoardAction | undefined {
  if (task.allowedCommands.includes('resolve_wait')) return 'resume';
  if (task.allowedCommands.includes('mark_ready')) return 'ready';
  if (task.allowedCommands.includes('start')) return 'run';
  if (task.allowedCommands.includes('request_review')) return 'review';
  if (task.phase === 'review' && task.allowedCommands.includes('close')) return 'complete';
  if (task.allowedCommands.includes('reopen')) return 'reopen';
  if (task.allowedCommands.includes('add_wait')) return 'pause';
  return undefined;
}
