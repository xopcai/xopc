import type { ProjectTaskCard, TaskPhase } from '@xopcai/gateway-contract';

export type TaskBoardAction =
  | 'ready'
  | 'run'
  | 'resume'
  | 'pause'
  | 'review'
  | 'complete'
  | 'reopen'
  | 'move_backlog'
  | 'move_ready'
  | 'move_active'
  | 'move_review'
  | 'reopen_backlog'
  | 'reopen_ready'
  | 'reopen_active'
  | 'reopen_review';

export type TaskBoardPrimaryAction = Exclude<TaskBoardAction, `${'move' | 'reopen'}_${string}`>;

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
  if (task.phase === 'closed' && targetPhase !== 'closed' && task.allowedCommands.includes('reopen')) {
    return `reopen_${targetPhase}`;
  }
  if (targetPhase === 'closed' && task.phase === 'review' && task.allowedCommands.includes('close')) return 'complete';
  if (targetPhase !== 'closed' && task.allowedCommands.includes('move')) return `move_${targetPhase}`;
  return undefined;
}

export function primaryTaskAction(task: ProjectTaskCard): TaskBoardPrimaryAction | undefined {
  if (task.allowedCommands.includes('resolve_wait')) return 'resume';
  if (task.allowedCommands.includes('mark_ready')) return 'ready';
  if (task.allowedCommands.includes('start')) return 'run';
  if (task.allowedCommands.includes('request_review')) return 'review';
  if (task.phase === 'review' && task.allowedCommands.includes('close')) return 'complete';
  if (task.allowedCommands.includes('reopen')) return 'reopen';
  if (task.allowedCommands.includes('add_wait')) return 'pause';
  return undefined;
}
