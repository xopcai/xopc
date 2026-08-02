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

export type WorkHomeDecision = {
  id: string;
  kind: 'work_item' | 'goal' | 'workflow_run' | 'automation_run' | 'connector_approval' | 'goal_evidence';
  title: string;
  detail?: string;
  reason: 'needs_input' | 'in_review' | 'blocked' | 'overdue' | 'due_soon' | 'run_failed' | 'approval_required';
  urgency: 'now' | 'soon';
  href: string;
  projectId?: string;
  projectName?: string;
  updatedAt: number;
  response?:
    | { kind: 'connector_approval'; approvalId: string }
    | { kind: 'goal_evidence'; goalId: string; requirementId: string };
};

export type WorkHomeBriefingWin = {
  id: string;
  kind: 'work_item' | 'workflow_run' | 'automation_run';
  title: string;
  href: string;
  completedAt: number;
};

export type WorkHomeProactiveInsight = {
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

export type WorkHomeCalendarSignal = {
  id: string;
  focusId: string;
  focusTitle: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  sourceInstanceId: string;
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
  proactiveInsights: WorkHomeProactiveInsight[];
  calendarSignals: WorkHomeCalendarSignal[];
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
    attention: WorkHomeWorkflowRun[];
    recent: WorkHomeWorkflowRun[];
  };
  upcomingAutomations: WorkHomeAutomation[];
};

export function fetchWorkHome(locale?: 'en' | 'zh'): Promise<WorkHomeResponse> {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return fetchJson<WorkHomeResponse>(apiUrl(`/api/home${suffix}`));
}

export function respondToProactiveInsight(
  insightId: string,
  status: 'read' | 'dismissed',
): Promise<{ ok: true; insight: WorkHomeProactiveInsight }> {
  return fetchJson(apiUrl(`/api/proactive/insights/${encodeURIComponent(insightId)}`), {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function approveProactiveInsight(
  insightId: string,
): Promise<{ ok: true; automationId: string; runId: string }> {
  return fetchJson(apiUrl(`/api/proactive/insights/${encodeURIComponent(insightId)}/approve`), {
    method: 'POST',
  });
}

export function prepareFocusCalendarSignal(
  focusId: string,
  signalId: string,
): Promise<{ ok: true }> {
  return fetchJson(apiUrl(
    `/api/focuses/${encodeURIComponent(focusId)}/calendar/${encodeURIComponent(signalId)}/prepare`,
  ), { method: 'POST' });
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
