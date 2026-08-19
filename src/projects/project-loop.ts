import type { MemoryRecord } from '../agent/memory/types.js';
import type { ProjectWithDetails } from './types.js';

export type ProjectWorkflowRunBrief = {
  runId: string;
  definitionId: string;
  status: string;
  createdAt: number;
  errorMessage?: string;
};

export type ProjectAttentionItem = {
  id: string;
  kind: 'blocked_task' | 'stale_task' | 'failed_workflow';
  title: string;
  detail?: string;
  status?: string;
  href?: string;
  updatedAt?: number;
};

export type ProjectTimelineItem = {
  id: string;
  kind: 'session' | 'task' | 'workflow' | 'memory';
  title: string;
  detail?: string;
  timestamp: number;
  status?: string;
  href?: string;
};

export type ProjectTask = {
  id: string;
  objective: string;
  status: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  nextAction?: string;
  blockedReason?: string;
  updatedAt: number;
};

export type ProjectLoopOverview = {
  activeTasks: ProjectTask[];
  blockedTasks: ProjectTask[];
  staleTasks: ProjectTask[];
  nextActions: Array<{
    taskId: string;
    title: string;
    nextAction?: string;
    status: string;
    updatedAt?: number;
  }>;
  attentionItems: ProjectAttentionItem[];
  timeline: ProjectTimelineItem[];
  digest: {
    status: 'healthy' | 'attention' | 'idle' | 'empty';
    summary: string;
    nextAction?: string;
  };
  failedWorkflowRuns: ProjectWorkflowRunBrief[];
  recommendedAction?: string;
};

const ACTIVE_TASK_STATUSES = new Set([
  'pending',
  'planning',
  'waiting_dependency',
  'running',
  'verifying',
  'paused',
  'blocked',
  'needs_user',
]);
const STALE_TASK_STATUSES = new Set([
  'pending',
  'planning',
  'waiting_dependency',
  'running',
  'verifying',
  'paused',
]);
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function taskUpdatedAtDesc(left: ProjectTask, right: ProjectTask): number {
  return right.updatedAt - left.updatedAt;
}

function compactText(value: string | undefined, max = 180): string | undefined {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3).trimEnd()}...`;
}

export function buildProjectLoopOverview(input: {
  project: ProjectWithDetails;
  tasks: ProjectTask[];
  recentWorkflowRuns: ProjectWorkflowRunBrief[];
  failedWorkflowRuns?: ProjectWorkflowRunBrief[];
  memoryRecords?: MemoryRecord[];
  nowMs?: number;
  staleAfterMs?: number;
}): ProjectLoopOverview {
  const nowMs = input.nowMs ?? Date.now();
  const staleCutoff = nowMs - (input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const projectTasks = [...input.tasks].sort(taskUpdatedAtDesc);
  const activeTasks = projectTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).slice(0, 6);
  const blockedTasks = projectTasks.filter((task) => task.status === 'blocked' || task.status === 'needs_user').slice(0, 4);
  const staleTasks = projectTasks
    .filter((task) => STALE_TASK_STATUSES.has(task.status) && task.updatedAt < staleCutoff)
    .slice(0, 5);
  const nextActions = activeTasks
    .filter((task) => task.nextAction?.trim())
    .slice(0, 5)
    .map((task) => ({
      taskId: task.id,
      title: task.objective,
      nextAction: task.nextAction,
      status: task.status,
      updatedAt: task.updatedAt,
    }));
  const failedWorkflowRuns = (input.failedWorkflowRuns ?? input.recentWorkflowRuns.filter((run) => (
    run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled'
  ))).slice(0, 5);

  const attentionItems: ProjectAttentionItem[] = [
    ...blockedTasks.map((task) => ({
      id: `task:${task.id}:blocked`,
      kind: 'blocked_task' as const,
      title: task.objective,
      detail: compactText(task.blockedReason || task.nextAction),
      status: task.status,
      href: `/tasks/${encodeURIComponent(task.id)}`,
      updatedAt: task.updatedAt,
    })),
    ...staleTasks.map((task) => ({
      id: `task:${task.id}:stale`,
      kind: 'stale_task' as const,
      title: task.objective,
      detail: compactText(task.nextAction || 'Task has not changed recently.'),
      status: task.status,
      href: `/tasks/${encodeURIComponent(task.id)}`,
      updatedAt: task.updatedAt,
    })),
    ...failedWorkflowRuns.map((run) => ({
      id: `workflow:${run.runId}:failed`,
      kind: 'failed_workflow' as const,
      title: run.definitionId,
      detail: compactText(run.errorMessage || run.status),
      status: run.status,
      href: `/workflows?run=${encodeURIComponent(run.runId)}`,
      updatedAt: run.createdAt,
    })),
  ].slice(0, 8);

  const timeline: ProjectTimelineItem[] = [
    ...input.project.recentSessions.map((session) => ({
      id: `session:${session.key}`,
      kind: 'session' as const,
      title: session.name ?? session.key,
      detail: session.agentId,
      timestamp: Date.parse(session.updatedAt),
      href: `/chat/${encodeURIComponent(session.key)}`,
    })),
    ...projectTasks.slice(0, 8).map((task) => ({
      id: `task:${task.id}`,
      kind: 'task' as const,
      title: task.objective,
      detail: compactText(task.nextAction || task.blockedReason),
      timestamp: task.updatedAt,
      status: task.status,
      href: `/tasks/${encodeURIComponent(task.id)}`,
    })),
    ...input.recentWorkflowRuns.map((run) => ({
      id: `workflow:${run.runId}`,
      kind: 'workflow' as const,
      title: run.definitionId,
      detail: run.status,
      timestamp: run.createdAt,
      status: run.status,
      href: `/workflows?run=${encodeURIComponent(run.runId)}`,
    })),
    ...(input.memoryRecords ?? []).slice(0, 5).map((record) => ({
      id: `memory:${record.id}`,
      kind: 'memory' as const,
      title: record.kind,
      detail: compactText(record.content),
      timestamp: Date.parse(record.updatedAt),
      status: record.status,
    })),
  ]
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 12);

  const recommendedAction = nextActions[0]?.nextAction
    ?? blockedTasks[0]?.blockedReason
    ?? staleTasks[0]?.nextAction
    ?? activeTasks[0]?.objective
    ?? (input.project.brief ? 'Open a new chat to continue from the project brief.' : undefined);

  const digestStatus =
    attentionItems.length > 0 ? 'attention'
      : activeTasks.length > 0 || input.recentWorkflowRuns.some((run) => run.status === 'running' || run.status === 'queued') ? 'healthy'
        : timeline.length > 0 ? 'idle'
          : 'empty';
  const digestSummary =
    digestStatus === 'attention'
      ? `${attentionItems.length} item(s) need attention: ${blockedTasks.length} blocker(s), ${staleTasks.length} stale task(s), ${failedWorkflowRuns.length} failed workflow run(s).`
      : digestStatus === 'healthy'
        ? `${activeTasks.length} active task(s), ${nextActions.length} next action(s), and ${input.recentWorkflowRuns.length} recent workflow run(s).`
        : digestStatus === 'idle'
          ? 'Recent activity exists, but no active task is driving the project.'
          : 'No project activity has been recorded yet.';

  return {
    activeTasks,
    blockedTasks,
    staleTasks,
    nextActions,
    attentionItems,
    timeline,
    digest: {
      status: digestStatus,
      summary: digestSummary,
      nextAction: recommendedAction,
    },
    failedWorkflowRuns,
    recommendedAction,
  };
}
