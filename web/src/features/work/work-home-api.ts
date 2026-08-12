import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { WorkItemPriority, WorkItemStatus } from '@/features/work-items/api';

export type WorkHomeItem = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  nextAction?: string;
  blockedReason?: string;
  dueAt?: number;
  completedAt?: number;
  updatedAt: number;
};

export type WorkHomeWorkflowRun = {
  id: string;
  definitionId: string;
  title: string;
  status: string;
  sessionKey?: string;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
};

export type WorkHomeAutomation = {
  id: string;
  name?: string;
  trigger: string;
  action: string;
  nextRunAt: string;
};

export type WorkHomeChat = {
  key: string;
  name: string;
  updatedAt?: string;
  active: boolean;
};

export type WorkHomeDecision = {
  id: string;
  kind: 'agent_judgment' | 'work_item' | 'goal' | 'connector_approval' | 'goal_evidence';
  title: string;
  detail?: string;
  reason: 'needs_input' | 'in_review' | 'blocked' | 'overdue' | 'due_soon' | 'decision_needed' | 'approval_required';
  urgency: 'now' | 'soon';
  href: string;
  projectId?: string;
  projectName?: string;
  updatedAt: number;
  judgment?: {
    inboxItemId: string;
    whyNow: string;
    impact: string;
    workDone: string;
    recommendation: string;
    confidence: number;
    decision?: { question: string; options: Array<{ id: string; label: string; consequence: string }> };
  };
  response?:
    | { kind: 'connector_approval'; approvalId: string }
    | { kind: 'goal_evidence'; goalId: string; requirementId: string };
};

export type WorkHomeAttention = {
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

export type WorkHomeBriefingWin = {
  id: string;
  kind: 'work_item' | 'workflow_run' | 'automation_run';
  title: string;
  href: string;
  completedAt: number;
};

export type WorkHomeResponse = {
  briefing: {
    generatedAt: number;
    summary: string;
    focus: WorkHomeDecision[];
    progress: {
      activeWorkCount: number;
      activeWorkflowCount: number;
      activeGoalCount: number;
      movingCount: number;
    };
    wins: WorkHomeBriefingWin[];
    nextScheduled?: WorkHomeAutomation;
  };
  decisions: WorkHomeDecision[];
  attention: WorkHomeAttention[];
  chats: {
    running: WorkHomeChat[];
    recent: WorkHomeChat[];
  };
  work: {
    attentionCount: number;
    overdueCount: number;
    todayCount: number;
    items: WorkHomeItem[];
    current: WorkHomeItem[];
    recentlyCompleted: WorkHomeItem[];
  };
  workflowRuns: {
    active: WorkHomeWorkflowRun[];
    recent: WorkHomeWorkflowRun[];
  };
  upcomingAutomations: WorkHomeAutomation[];
};

export function fetchWorkHome(locale?: 'en' | 'zh'): Promise<WorkHomeResponse> {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return fetchJson<WorkHomeResponse>(apiUrl(`/api/home${suffix}`));
}

export function respondToWorkDecision(
  response: NonNullable<WorkHomeDecision['response']>,
  decision: 'approve' | 'deny',
): Promise<{ ok: true; status: string }> {
  return fetchJson(apiUrl('/api/home/decisions/respond'), {
    method: 'POST',
    body: JSON.stringify({ ...response, decision }),
  });
}

export function acknowledgeWorkAttention(
  item: Pick<WorkHomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; status: 'acknowledged' }> {
  return fetchJson(apiUrl('/api/home/attention/acknowledge'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export function decideAgentJudgment(itemId: string, choice: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/decisions`), {
    method: 'POST', body: JSON.stringify({ choice }),
  });
}

export function transitionAgentJudgment(itemId: string, status: 'read' | 'snoozed' | 'resolved'): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/transition`), {
    method: 'POST',
    body: JSON.stringify(status === 'snoozed'
      ? { status, snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      : status === 'resolved' ? { status, resolution: 'dismissed' } : { status }),
  });
}

export function instructAgentJudgment(itemId: string, instruction: string): Promise<{ ok: true; revisionId: string }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/instructions`), {
    method: 'POST', body: JSON.stringify({ instruction }),
  });
}

export function retryWorkAttention(
  item: Pick<WorkHomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; sessionKey?: string }> {
  return fetchJson(apiUrl('/api/home/attention/retry'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}
