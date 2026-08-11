import { z } from 'zod';

import { apiFetch } from '../api/client';
import type { Language } from '../stores/preferences-store';
import type { NoteIndexEntry } from './notes';
import type { SessionListItem } from './sessions';
import type { WorkItem, WorkItemPriority, WorkItemStatus } from './work-items';

export type HomeAgent = {
  id: string;
  name?: string;
  description?: string;
};

export type HomeGateway = {
  status: string;
  ready: boolean;
  httpListening: boolean;
  version: string;
  uptime: number;
  tunnel: {
    state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
    publicUrl: string | null;
    connected: boolean;
  };
};

export type HomeWorkflowRun = {
  id: string;
  definitionId: string;
  title: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  sessionKey?: string;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  metrics: {
    agentCount: number;
    doneAgentCount: number;
    errorAgentCount: number;
    skippedAgentCount: number;
    artifactCount: number;
    durationMs?: number;
  };
};

export type HomeAutomation = {
  id: string;
  name?: string;
  trigger: string;
  action: string;
  nextRunAt: string;
};

export type HomeDecision = {
  id: string;
  kind: 'work_item' | 'goal' | 'connector_approval' | 'goal_evidence';
  title: string;
  detail?: string;
  reason: 'needs_input' | 'in_review' | 'blocked' | 'overdue' | 'due_soon' | 'approval_required';
  urgency: 'now' | 'soon';
  href: string;
  projectId?: string;
  projectName?: string;
  updatedAt: number;
  response?:
    | { kind: 'connector_approval'; approvalId: string }
    | { kind: 'goal_evidence'; goalId: string; requirementId: string };
};

export type HomeAttention = {
  id: string;
  kind: 'automation_run' | 'workflow_run';
  runId: string;
  title: string;
  detail: string;
  reason: 'run_failed' | 'run_timeout';
  href: string;
  updatedAt: number;
  sessionKey?: string;
};

export type HomeBriefing = {
  generatedAt: number;
  summary: string;
  focus: HomeDecision[];
  progress: {
    activeWorkCount: number;
    activeWorkflowCount: number;
    activeGoalCount: number;
    movingCount: number;
  };
  wins: Array<{
    id: string;
    kind: 'work_item' | 'workflow_run' | 'automation_run';
    title: string;
    href: string;
    completedAt: number;
  }>;
  nextScheduled?: HomeAutomation;
};

export type HomeProactiveInsight = {
  id: string;
  watchId: string;
  runId: string;
  kind: 'progress' | 'staleness' | 'deadline' | 'intelligence';
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: Array<{ label: string; source?: string; publishedAt?: string }>;
  status: 'unread' | 'read' | 'approved' | 'dismissed';
  createdAt: number;
};

export type HomeCalendarSignal = {
  id: string;
  focusId: string;
  focusTitle: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  sourceInstanceId: string;
};

type HomeWorkItem = Pick<
  WorkItem,
  'id' | 'projectId' | 'title' | 'nextAction' | 'blockedReason' | 'dueAt' | 'completedAt' | 'updatedAt'
> & {
  projectName: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
};

export interface HomeData {
  briefing: HomeBriefing;
  decisions: HomeDecision[];
  attention: HomeAttention[];
  proactiveInsights: HomeProactiveInsight[];
  calendarSignals: HomeCalendarSignal[];
  recentlyOpened: NoteIndexEntry[];
  inboxCount: number;
  pendingTasks: NoteIndexEntry[];
  pendingTaskCount: number;
  recentSessions: SessionListItem[];
  activeAgent: HomeAgent;
  gateway: HomeGateway;
  workflowRuns: {
    active: HomeWorkflowRun[];
    recent: HomeWorkflowRun[];
  };
  work: {
    attentionCount: number;
    overdueCount: number;
    todayCount: number;
    items: HomeWorkItem[];
    current: HomeWorkItem[];
    recentlyCompleted: HomeWorkItem[];
  };
  upcomingAutomations: HomeAutomation[];
}

const decisionResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('connector_approval'), approvalId: z.string() }),
  z.object({ kind: z.literal('goal_evidence'), goalId: z.string(), requirementId: z.string() }),
]);

const decisionSchema = z.object({
  id: z.string(),
  kind: z.enum(['work_item', 'goal', 'connector_approval', 'goal_evidence']),
  title: z.string(),
  detail: z.string().optional(),
  reason: z.enum(['needs_input', 'in_review', 'blocked', 'overdue', 'due_soon', 'approval_required']),
  urgency: z.enum(['now', 'soon']),
  href: z.string(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  updatedAt: z.number(),
  response: decisionResponseSchema.optional(),
});

const actionableHomeSchema = z.object({
  briefing: z.object({
    generatedAt: z.number(),
    summary: z.string(),
    focus: z.array(decisionSchema),
    progress: z.object({
      activeWorkCount: z.number(),
      activeWorkflowCount: z.number(),
      activeGoalCount: z.number(),
      movingCount: z.number(),
    }),
    wins: z.array(z.object({
      id: z.string(),
      kind: z.enum(['work_item', 'workflow_run', 'automation_run']),
      title: z.string(),
      href: z.string(),
      completedAt: z.number(),
    })),
    nextScheduled: z.object({
      id: z.string(),
      name: z.string().optional(),
      trigger: z.string(),
      action: z.string(),
      nextRunAt: z.string(),
    }).optional(),
  }),
  decisions: z.array(decisionSchema),
  attention: z.array(z.object({
    id: z.string(),
    kind: z.enum(['automation_run', 'workflow_run']),
    runId: z.string(),
    title: z.string(),
    detail: z.string(),
    reason: z.enum(['run_failed', 'run_timeout']),
    href: z.string(),
    updatedAt: z.number(),
    sessionKey: z.string().optional(),
  })),
  proactiveInsights: z.array(z.object({
    id: z.string(),
    watchId: z.string(),
    runId: z.string(),
    kind: z.enum(['progress', 'staleness', 'deadline', 'intelligence']),
    title: z.string(),
    summary: z.string(),
    whyItMatters: z.string(),
    nextAction: z.string(),
    evidence: z.array(z.object({
      label: z.string(),
      source: z.string().optional(),
      publishedAt: z.string().optional(),
    })),
    status: z.enum(['unread', 'read', 'approved', 'dismissed']),
    createdAt: z.number(),
  })).optional().default([]),
  calendarSignals: z.array(z.object({
    id: z.string(),
    focusId: z.string(),
    focusTitle: z.string(),
    title: z.string(),
    startsAt: z.number(),
    endsAt: z.number().optional(),
    sourceInstanceId: z.string(),
  })).optional().default([]),
});

function normalizedSessionName(session: SessionListItem): string | undefined {
  return session.name?.trim() || session.title?.trim() || session.displayName?.trim() || undefined;
}

export async function fetchHome(language: Language): Promise<HomeData> {
  const res = await apiFetch(`/api/home?locale=${encodeURIComponent(language)}`);
  if (!res.ok) throw new Error(`Failed to fetch home: ${res.status}`);
  const raw = (await res.json()) as HomeData;
  const actionable = actionableHomeSchema.parse(raw);
  return {
    ...raw,
    proactiveInsights: actionable.proactiveInsights,
    calendarSignals: actionable.calendarSignals,
    recentSessions: raw.recentSessions.map((session) => ({
      ...session,
      name: normalizedSessionName(session),
    })),
  };
}

export async function respondToHomeDecision(
  response: NonNullable<HomeDecision['response']>,
  decision: 'approve' | 'deny',
): Promise<{ ok: true; status: string }> {
  const res = await apiFetch('/api/home/decisions/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...response, decision }),
  });
  if (!res.ok) throw new Error(`Failed to respond to decision: ${res.status}`);
  return res.json() as Promise<{ ok: true; status: string }>;
}

export async function acknowledgeHomeAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; status: 'acknowledged' }> {
  const res = await apiFetch('/api/home/attention/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to acknowledge attention item: ${res.status}`);
  return res.json() as Promise<{ ok: true; status: 'acknowledged' }>;
}

export async function retryHomeAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; sessionKey?: string }> {
  const res = await apiFetch('/api/home/attention/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to retry attention item: ${res.status}`);
  return res.json() as Promise<{ ok: true; runId: string; sessionKey?: string }>;
}
