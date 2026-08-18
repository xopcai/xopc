import type { GoalWithDetails } from '../goals/index.js';
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
  kind: 'blocked_goal' | 'stale_goal' | 'failed_workflow';
  title: string;
  detail?: string;
  status?: string;
  href?: string;
  updatedAt?: number;
};

export type ProjectTimelineItem = {
  id: string;
  kind: 'session' | 'goal' | 'workflow' | 'memory';
  title: string;
  detail?: string;
  timestamp: number;
  status?: string;
  href?: string;
};

export type ProjectLoopOverview = {
  activeGoals: GoalWithDetails[];
  blockedGoals: GoalWithDetails[];
  staleGoals: GoalWithDetails[];
  nextActions: Array<{
    goalId: string;
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

const ACTIVE_GOAL_STATUSES = new Set(['active', 'paused', 'blocked', 'needs_input']);
const STALE_GOAL_STATUSES = new Set(['active', 'paused']);
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function goalUpdatedAtDesc(left: GoalWithDetails, right: GoalWithDetails): number {
  return right.updatedAt - left.updatedAt;
}

function compactText(value: string | undefined, max = 180): string | undefined {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3).trimEnd()}...`;
}

export function buildProjectLoopOverview(input: {
  project: ProjectWithDetails;
  goals: GoalWithDetails[];
  recentWorkflowRuns: ProjectWorkflowRunBrief[];
  failedWorkflowRuns?: ProjectWorkflowRunBrief[];
  memoryRecords?: MemoryRecord[];
  nowMs?: number;
  staleAfterMs?: number;
}): ProjectLoopOverview {
  const nowMs = input.nowMs ?? Date.now();
  const staleCutoff = nowMs - (input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const projectGoals = [...input.goals].sort(goalUpdatedAtDesc);
  const activeGoals = projectGoals.filter((goal) => ACTIVE_GOAL_STATUSES.has(goal.status)).slice(0, 6);
  const blockedGoals = projectGoals.filter((goal) => goal.status === 'blocked' || goal.status === 'needs_input').slice(0, 4);
  const staleGoals = projectGoals
    .filter((goal) => STALE_GOAL_STATUSES.has(goal.status) && goal.updatedAt < staleCutoff)
    .slice(0, 5);
  const nextActions = activeGoals
    .filter((goal) => goal.nextAction?.trim())
    .slice(0, 5)
    .map((goal) => ({
      goalId: goal.id,
      title: goal.title,
      nextAction: goal.nextAction,
      status: goal.status,
      updatedAt: goal.updatedAt,
    }));
  const failedWorkflowRuns = (input.failedWorkflowRuns ?? input.recentWorkflowRuns.filter((run) => (
    run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled'
  ))).slice(0, 5);

  const attentionItems: ProjectAttentionItem[] = [
    ...blockedGoals.map((goal) => ({
      id: `goal:${goal.id}:blocked`,
      kind: 'blocked_goal' as const,
      title: goal.title,
      detail: compactText(goal.blockedReason || goal.nextAction || goal.description),
      status: goal.status,
      href: `/work/${encodeURIComponent(goal.outcomeId)}`,
      updatedAt: goal.updatedAt,
    })),
    ...staleGoals.map((goal) => ({
      id: `goal:${goal.id}:stale`,
      kind: 'stale_goal' as const,
      title: goal.title,
      detail: compactText(goal.nextAction || goal.description || 'Goal has not changed recently.'),
      status: goal.status,
      href: `/work/${encodeURIComponent(goal.outcomeId)}`,
      updatedAt: goal.updatedAt,
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
    ...projectGoals.slice(0, 8).map((goal) => ({
      id: `goal:${goal.id}`,
      kind: 'goal' as const,
      title: goal.title,
      detail: compactText(goal.nextAction || goal.blockedReason || goal.description),
      timestamp: goal.updatedAt,
      status: goal.status,
      href: `/work/${encodeURIComponent(goal.outcomeId)}`,
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
    ?? blockedGoals[0]?.blockedReason
    ?? staleGoals[0]?.nextAction
    ?? activeGoals[0]?.title
    ?? (input.project.brief ? 'Open a new chat to continue from the project brief.' : undefined);

  const digestStatus =
    attentionItems.length > 0 ? 'attention'
      : activeGoals.length > 0 || input.recentWorkflowRuns.some((run) => run.status === 'running' || run.status === 'queued') ? 'healthy'
        : timeline.length > 0 ? 'idle'
          : 'empty';
  const digestSummary =
    digestStatus === 'attention'
      ? `${attentionItems.length} item(s) need attention: ${blockedGoals.length} blocker(s), ${staleGoals.length} stale goal(s), ${failedWorkflowRuns.length} failed workflow run(s).`
      : digestStatus === 'healthy'
        ? `${activeGoals.length} active goal(s), ${nextActions.length} next action(s), and ${input.recentWorkflowRuns.length} recent workflow run(s).`
        : digestStatus === 'idle'
          ? 'Recent activity exists, but no active goal is driving the project.'
          : 'No project activity has been recorded yet.';

  return {
    activeGoals,
    blockedGoals,
    staleGoals,
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
