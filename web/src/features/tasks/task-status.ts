import {
  taskPresentationStage,
  type TaskOperationalState,
  type TaskPhase,
  type TaskPresentation,
  type TaskPresentationStage,
  type TaskResolution,
} from '@xopcai/gateway-contract';

import { taskCopy } from './task-copy';

export { taskPresentationStage };
export type { TaskPresentationStage };

export type TaskStatusInput =
  | TaskPresentation['status']
  | TaskPhase
  | TaskOperationalState
  | TaskResolution
  | 'succeeded'
  | 'timeout'
  | (string & {});

const PHASE_LABELS: Record<'zh' | 'en', Record<TaskPhase, string>> = {
  zh: {
    backlog: '待规划',
    ready: '就绪',
    active: '进行中',
    review: '待验收',
    closed: '已关闭',
  },
  en: {
    backlog: 'Backlog',
    ready: 'Ready',
    active: 'Active',
    review: 'Review',
    closed: 'Closed',
  },
};

const RESOLUTION_LABELS: Record<'zh' | 'en', Record<TaskResolution, string>> = {
  zh: {
    done: '已完成',
    cancelled: '已取消',
    duplicate: '重复',
    wont_do: '不做',
  },
  en: {
    done: 'Done',
    cancelled: 'Cancelled',
    duplicate: 'Duplicate',
    wont_do: "Won't do",
  },
};

const STAGE_LABELS: Record<'zh' | 'en', Record<TaskPresentationStage, string>> = {
  zh: {
    backlog: '待规划',
    ready: '待开始',
    in_progress: '推进中',
    needs_user: '需你处理',
    review: '待验收',
    completed: '已完成',
    ended: '已结束',
  },
  en: {
    backlog: 'Backlog',
    ready: 'Ready',
    in_progress: 'In progress',
    needs_user: 'Needs attention',
    review: 'Review',
    completed: 'Completed',
    ended: 'Ended',
  },
};

export function formatTaskPhase(phase: TaskPhase, language: 'zh' | 'en'): string {
  return PHASE_LABELS[language][phase];
}

export function formatTaskResolution(resolution: TaskResolution, language: 'zh' | 'en'): string {
  return RESOLUTION_LABELS[language][resolution];
}

export function formatTaskStage(stage: TaskPresentationStage, language: 'zh' | 'en'): string {
  return STAGE_LABELS[language][stage];
}

export function formatTaskPresentationStatus(
  status: TaskPresentation['status'],
  language: 'zh' | 'en',
): string {
  return taskCopy(language).detailStatuses[status];
}

/**
 * Normalize any presentation status, phase, run status, or operational state into a localized label.
 * Never leaks raw backend enum identifiers to the UI.
 */
export function formatTaskRawStatus(
  raw: TaskStatusInput | undefined,
  language: 'zh' | 'en',
  resolution?: TaskResolution,
): string {
  const copy = taskCopy(language).detailStatuses;
  if (!raw) return copy.ready;
  if (raw === 'closed') {
    return resolution ? formatTaskResolution(resolution, language) : formatTaskPhase('closed', language);
  }
  if (raw in copy) return copy[raw as TaskPresentation['status']];
  if (raw in PHASE_LABELS[language]) return PHASE_LABELS[language][raw as TaskPhase];
  if (raw in RESOLUTION_LABELS[language]) return RESOLUTION_LABELS[language][raw as TaskResolution];
  if (raw === 'succeeded' || raw === 'done') return copy.completed;
  if (raw === 'idle') return copy.ready;
  if (raw === 'timeout') return language === 'zh' ? '执行超时' : 'Timed out';
  return copy.ready;
}

export function taskStatusBadgeTone(status: TaskStatusInput | undefined): string {
  if (status === 'failed' || status === 'timeout') return 'bg-danger/10 text-danger';
  if (status === 'needsUser' || status === 'blocked' || status === 'paused') return 'bg-warning/10 text-warning';
  if (status === 'completed' || status === 'succeeded' || status === 'done') return 'bg-success-soft text-success';
  if (status === 'running' || status === 'verifying' || status === 'review' || status === 'active' || status === 'allocating' || status === 'queued') {
    return 'bg-accent-soft text-accent-fg';
  }
  return 'bg-surface-hover text-fg-muted';
}

export function taskStatusDotTone(status: TaskStatusInput | undefined): string {
  if (status === 'failed' || status === 'timeout') return 'bg-danger';
  if (status === 'needsUser' || status === 'blocked' || status === 'paused') return 'bg-warning';
  if (status === 'completed' || status === 'succeeded' || status === 'done') return 'bg-success';
  if (status === 'running' || status === 'verifying' || status === 'review' || status === 'active' || status === 'allocating' || status === 'queued') {
    return 'bg-accent';
  }
  return 'bg-fg-subtle';
}
