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
  kind: 'blocked_outcome' | 'stale_outcome' | 'failed_workflow';
  title: string;
  detail?: string;
  status?: string;
  href?: string;
  updatedAt?: number;
};

export type ProjectTimelineItem = {
  id: string;
  kind: 'session' | 'outcome' | 'workflow' | 'memory';
  title: string;
  detail?: string;
  timestamp: number;
  status?: string;
  href?: string;
};

export type ProjectOutcome = {
  id: string;
  objective: string;
  status: string;
  priority: 'low' | 'normal' | 'high';
  description?: string;
  nextAction?: string;
  blockedReason?: string;
  updatedAt: number;
};

export type ProjectLoopOverview = {
  activeOutcomes: ProjectOutcome[];
  blockedOutcomes: ProjectOutcome[];
  staleOutcomes: ProjectOutcome[];
  nextActions: Array<{
    outcomeId: string;
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

const ACTIVE_OUTCOME_STATUSES = new Set(['captured', 'planning', 'running', 'verifying', 'continuing', 'paused', 'blocked', 'needs_user']);
const STALE_OUTCOME_STATUSES = new Set(['captured', 'planning', 'running', 'verifying', 'continuing', 'paused']);
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function outcomeUpdatedAtDesc(left: ProjectOutcome, right: ProjectOutcome): number {
  return right.updatedAt - left.updatedAt;
}

function compactText(value: string | undefined, max = 180): string | undefined {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3).trimEnd()}...`;
}

export function buildProjectLoopOverview(input: {
  project: ProjectWithDetails;
  outcomes: ProjectOutcome[];
  recentWorkflowRuns: ProjectWorkflowRunBrief[];
  failedWorkflowRuns?: ProjectWorkflowRunBrief[];
  memoryRecords?: MemoryRecord[];
  nowMs?: number;
  staleAfterMs?: number;
}): ProjectLoopOverview {
  const nowMs = input.nowMs ?? Date.now();
  const staleCutoff = nowMs - (input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const projectOutcomes = [...input.outcomes].sort(outcomeUpdatedAtDesc);
  const activeOutcomes = projectOutcomes.filter((outcome) => ACTIVE_OUTCOME_STATUSES.has(outcome.status)).slice(0, 6);
  const blockedOutcomes = projectOutcomes.filter((outcome) => outcome.status === 'blocked' || outcome.status === 'needs_user').slice(0, 4);
  const staleOutcomes = projectOutcomes
    .filter((outcome) => STALE_OUTCOME_STATUSES.has(outcome.status) && outcome.updatedAt < staleCutoff)
    .slice(0, 5);
  const nextActions = activeOutcomes
    .filter((outcome) => outcome.nextAction?.trim())
    .slice(0, 5)
    .map((outcome) => ({
      outcomeId: outcome.id,
      title: outcome.objective,
      nextAction: outcome.nextAction,
      status: outcome.status,
      updatedAt: outcome.updatedAt,
    }));
  const failedWorkflowRuns = (input.failedWorkflowRuns ?? input.recentWorkflowRuns.filter((run) => (
    run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled'
  ))).slice(0, 5);

  const attentionItems: ProjectAttentionItem[] = [
    ...blockedOutcomes.map((outcome) => ({
      id: `outcome:${outcome.id}:blocked`,
      kind: 'blocked_outcome' as const,
      title: outcome.objective,
      detail: compactText(outcome.blockedReason || outcome.nextAction || outcome.description),
      status: outcome.status,
      href: `/work/${encodeURIComponent(outcome.id)}`,
      updatedAt: outcome.updatedAt,
    })),
    ...staleOutcomes.map((outcome) => ({
      id: `outcome:${outcome.id}:stale`,
      kind: 'stale_outcome' as const,
      title: outcome.objective,
      detail: compactText(outcome.nextAction || outcome.description || 'Outcome has not changed recently.'),
      status: outcome.status,
      href: `/work/${encodeURIComponent(outcome.id)}`,
      updatedAt: outcome.updatedAt,
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
    ...projectOutcomes.slice(0, 8).map((outcome) => ({
      id: `outcome:${outcome.id}`,
      kind: 'outcome' as const,
      title: outcome.objective,
      detail: compactText(outcome.nextAction || outcome.blockedReason || outcome.description),
      timestamp: outcome.updatedAt,
      status: outcome.status,
      href: `/work/${encodeURIComponent(outcome.id)}`,
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
    ?? blockedOutcomes[0]?.blockedReason
    ?? staleOutcomes[0]?.nextAction
    ?? activeOutcomes[0]?.objective
    ?? (input.project.brief ? 'Open a new chat to continue from the project brief.' : undefined);

  const digestStatus =
    attentionItems.length > 0 ? 'attention'
      : activeOutcomes.length > 0 || input.recentWorkflowRuns.some((run) => run.status === 'running' || run.status === 'queued') ? 'healthy'
        : timeline.length > 0 ? 'idle'
          : 'empty';
  const digestSummary =
    digestStatus === 'attention'
      ? `${attentionItems.length} item(s) need attention: ${blockedOutcomes.length} blocker(s), ${staleOutcomes.length} stale outcome(s), ${failedWorkflowRuns.length} failed workflow run(s).`
      : digestStatus === 'healthy'
        ? `${activeOutcomes.length} active outcome(s), ${nextActions.length} next action(s), and ${input.recentWorkflowRuns.length} recent workflow run(s).`
        : digestStatus === 'idle'
          ? 'Recent activity exists, but no active outcome is driving the project.'
          : 'No project activity has been recorded yet.';

  return {
    activeOutcomes,
    blockedOutcomes,
    staleOutcomes,
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
