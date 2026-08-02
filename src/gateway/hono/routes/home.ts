import type { Hono } from 'hono';

import { listGatewayAgents } from '../../agents-admin.js';
import { getTunnelService } from '../../../tunnel/index.js';
import type { Automation, AutomationRun } from '../../../automations/index.js';
import { GoalService, type GoalWithDetails } from '../../../goals/index.js';
import { FocusService, listFocusCalendarSignals, listProactiveInsights } from '../../../proactive/index.js';
import type { WorkflowRunSummary } from '../../../workflows/domain/index.js';
import { WorkItemService } from '../../../work-items/index.js';
import { decideConnectorApproval, listConnectorApprovals } from '../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

type HomeDecisionKind = 'work_item' | 'goal' | 'workflow_run' | 'automation_run' | 'connector_approval' | 'goal_evidence';
type HomeDecisionReason =
  | 'needs_input'
  | 'in_review'
  | 'blocked'
  | 'overdue'
  | 'due_soon'
  | 'run_failed'
  | 'approval_required';

type HomeDecision = {
  id: string;
  kind: HomeDecisionKind;
  title: string;
  detail?: string;
  reason: HomeDecisionReason;
  urgency: 'now' | 'soon';
  href: string;
  projectId?: string;
  projectName?: string;
  updatedAt: number;
  response?:
    | { kind: 'connector_approval'; approvalId: string }
    | { kind: 'goal_evidence'; goalId: string; requirementId: string };
};

type HomeBriefingWin = {
  id: string;
  kind: 'work_item' | 'workflow_run' | 'automation_run';
  title: string;
  href: string;
  completedAt: number;
};

type HomeWorkflowRun = {
  id: string;
  definitionId: string;
  title: string;
  status: WorkflowRunSummary['status'];
  sessionKey?: string;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  metrics: WorkflowRunSummary['metrics'];
};

type HomeAutomation = {
  id: string;
  name?: string;
  trigger: string;
  action: string;
  nextRunAt: string;
};

type HomeAutomationRun = {
  id: string;
  automationId: string;
  automationName?: string;
  status: AutomationRun['status'];
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  error?: string;
  summary?: string;
  sessionKey?: string;
  workflowRunId?: string;
};

function workItemAttentionRank(item: { status: string; dueAt?: number; priority: string; updatedAt: number }, nowMs: number): number {
  if (item.status === 'needs_input' || item.status === 'in_review' || item.status === 'blocked') return 0;
  if (item.dueAt != null && item.dueAt < nowMs) return 1;
  if (item.dueAt != null && item.dueAt < nowMs + 24 * 60 * 60 * 1000) return 2;
  if (item.priority === 'urgent') return 3;
  return 4;
}

function toHomeWorkItem(
  item: {
    id: string;
    projectId: string;
    title: string;
    status: string;
    priority: string;
    nextAction?: string;
    blockedReason?: string;
    dueAt?: number;
    completedAt?: number;
    updatedAt: number;
  },
  projectName: string,
) {
  return {
    id: item.id,
    projectId: item.projectId,
    projectName,
    title: item.title,
    status: item.status,
    priority: item.priority,
    nextAction: item.nextAction,
    blockedReason: item.blockedReason,
    dueAt: item.dueAt,
    completedAt: item.completedAt,
    updatedAt: item.updatedAt,
  };
}

function toHomeWorkflowRun(run: WorkflowRunSummary): HomeWorkflowRun {
  return {
    id: run.id,
    definitionId: run.definitionId,
    title: run.title,
    status: run.status,
    sessionKey: run.metadata?.sessionKey,
    createdAtMs: run.createdAtMs,
    startedAtMs: run.startedAtMs,
    completedAtMs: run.completedAtMs,
    metrics: run.metrics,
  };
}

function triggerLabel(automation: Automation): string {
  const trigger = automation.trigger;
  if (trigger.kind === 'manual') return 'manual';
  if (trigger.kind === 'webhook') return 'webhook';
  if (trigger.kind === 'event') return `event:${trigger.eventType}`;
  const schedule = trigger.schedule;
  if (schedule.kind === 'once') return schedule.at;
  if (schedule.kind === 'interval') return `every ${Math.round(schedule.everyMs / 60000)} minutes`;
  return schedule.expr;
}

function actionLabel(automation: Automation): string {
  if (automation.action.kind === 'workflow') return `workflow:${automation.action.workflowId}`;
  return automation.action.agentId ? `agent:${automation.action.agentId}` : 'agent';
}

function toHomeAutomation(automation: Automation): HomeAutomation | null {
  if (!automation.enabled || !automation.state.nextRunAtMs) return null;
  return {
    id: automation.id,
    name: automation.name,
    trigger: triggerLabel(automation),
    action: actionLabel(automation),
    nextRunAt: new Date(automation.state.nextRunAtMs).toISOString(),
  };
}

function toHomeAutomationRun(run: AutomationRun): HomeAutomationRun {
  return {
    id: run.id,
    automationId: run.automationId,
    automationName: run.automationName,
    status: run.status,
    createdAtMs: run.createdAtMs,
    startedAtMs: run.startedAtMs,
    endedAtMs: run.endedAtMs,
    error: run.error,
    summary: run.summary,
    sessionKey: run.sessionKey,
    workflowRunId: run.workflowRunId,
  };
}

function decisionFromGoal(goal: GoalWithDetails, projectName?: string): HomeDecision | null {
  if (goal.status !== 'needs_input' && goal.status !== 'blocked') return null;
  return {
    id: `goal:${goal.id}`,
    kind: 'goal',
    title: goal.title,
    detail: goal.blockedReason || goal.nextAction,
    reason: goal.status,
    urgency: 'now',
    href: `/goals/${encodeURIComponent(goal.id)}`,
    projectId: goal.projectId,
    projectName,
    updatedAt: goal.updatedAt,
  };
}

function decisionFromWorkItem(
  item: Parameters<typeof toHomeWorkItem>[0],
  projectName: string,
  nowMs: number,
): HomeDecision | null {
  let reason: HomeDecisionReason | undefined;
  let urgency: HomeDecision['urgency'] = 'now';
  if (item.status === 'needs_input' || item.status === 'in_review' || item.status === 'blocked') {
    reason = item.status;
  } else if (item.dueAt != null && item.dueAt < nowMs) {
    reason = 'overdue';
  } else if (item.dueAt != null && item.dueAt < nowMs + 24 * 60 * 60 * 1000) {
    reason = 'due_soon';
    urgency = 'soon';
  }
  if (!reason) return null;
  return {
    id: `work:${item.id}`,
    kind: 'work_item',
    title: item.title,
    detail: item.blockedReason || item.nextAction,
    reason,
    urgency,
    href: `/work-items/${encodeURIComponent(item.id)}`,
    projectId: item.projectId,
    projectName,
    updatedAt: item.updatedAt,
  };
}

export function buildHomeBriefing(input: {
  locale?: string;
  decisions: HomeDecision[];
  activeWorkCount: number;
  activeWorkflowCount: number;
  activeGoalCount: number;
  wins: HomeBriefingWin[];
  nextScheduled?: HomeAutomation;
  nowMs: number;
}) {
  const isChinese = input.locale?.toLowerCase().startsWith('zh') ?? false;
  const movingCount = input.activeWorkCount + input.activeWorkflowCount + input.activeGoalCount;
  const summary = input.decisions.length > 0
    ? isChinese
      ? `有 ${input.decisions.length} 件事等你决定；我正在继续推进 ${movingCount} 件工作。`
      : `${input.decisions.length} ${input.decisions.length === 1 ? 'item needs' : 'items need'} your decision; I’m continuing ${movingCount} in the background.`
    : movingCount > 0
      ? isChinese
        ? `目前没有事情需要你处理；我正在继续推进 ${movingCount} 件工作。`
        : `Nothing needs you right now; I’m continuing ${movingCount} ${movingCount === 1 ? 'item' : 'items'} in the background.`
      : isChinese
        ? '今天还没有正在推进的事项。把想要的结果交给我，我会从这里开始。'
        : 'Nothing is moving yet today. Hand me an outcome and I’ll take it from here.';
  return {
    generatedAt: input.nowMs,
    summary,
    focus: input.decisions.slice(0, 3),
    progress: {
      activeWorkCount: input.activeWorkCount,
      activeWorkflowCount: input.activeWorkflowCount,
      activeGoalCount: input.activeGoalCount,
      movingCount,
    },
    wins: input.wins.slice(0, 5),
    nextScheduled: input.nextScheduled,
  };
}

/**
 * GET /api/home — Aggregated data for the user's cross-project work home.
 *
 * Returns:
 *   - recentlyOpened: notes sorted by lastOpenedAt (continue rail)
 *   - inboxCount: number of notes with status === 'inbox'
 *   - pendingTasks: task notes where done === false
 *   - recentSessions: last 5 active AI sessions (threads)
 *   - activeAgent: default agent identity for this gateway
 *   - gateway: readiness + public tunnel status
 *   - workflowRuns: active / attention / recent workflow runs
 *   - upcomingAutomations: upcoming enabled automations
 *   - recentAutomationRuns: latest automation executions
 */
export function registerHomeRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const goals = new GoalService();
  const focuses = new FocusService(service.automationServiceInstance);

  authenticated.get('/api/home', async (c) => {
    const notes = service.notesServiceInstance;
    const sessions = service.sessions;
    const agents = await listGatewayAgents(service.currentConfig);
    const defaultAgent = agents.agents.find((agent) => agent.id === agents.defaultId) ?? agents.agents[0];
    const workflowRunService = service.createWorkflowRunService();
    const workflowRunStore = workflowRunService.createRunStore(defaultAgent?.id ?? agents.defaultId);
    const tunnel = getTunnelService().getStatus();
    const health = service.getHealth();
    const workItems = new WorkItemService();
    const nowMs = Date.now();
    await focuses.reconcileExpiredTrials(nowMs);
    const focusViews = focuses.list();

    const [
      recentlyOpened,
      inbox,
      pendingTasks,
      recentSessions,
      workflowRuns,
      automations,
      automationRuns,
      projects,
      allWorkItems,
      activeGoals,
      connectorApprovals,
      proactiveInsights,
      calendarSignals,
    ] = await Promise.all([
      notes.listNotes({ sortBy: 'lastOpenedAt', sortOrder: 'desc', limit: 10 }),
      notes.listNotes({ status: 'inbox', limit: 0 }),
      notes.listNotes({ pendingTasksOnly: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 10 }),
      sessions.listSessions({ sortBy: 'updatedAt', sortOrder: 'desc', limit: 5 }),
      workflowRunStore.listRunSummaries(20),
      service.automationServiceInstance.list(),
      service.automationServiceInstance.listRuns({ limit: 10 }),
      service.projects.list({ limit: 500 }),
      Promise.resolve(workItems.listWorkItems({ limit: 100 })),
      Promise.resolve(goals.list({ status: ['active', 'blocked', 'needs_input', 'paused'], limit: 100 })),
      Promise.resolve(listConnectorApprovals({ principalId: 'local-owner', status: 'pending', limit: 100 })),
      Promise.resolve(listProactiveInsights({ status: ['unread'], limit: 10 })),
      Promise.resolve(listFocusCalendarSignals(focusViews, nowMs)),
    ]);
    const projectsById = new Map(projects.items.map((project) => [project.id, project]));
    const activeWorkItems = allWorkItems.items
      .filter((item) => item.status !== 'done' && item.status !== 'cancelled')
      .sort((left, right) => {
        const rank = workItemAttentionRank(left, nowMs) - workItemAttentionRank(right, nowMs);
        return rank || right.updatedAt - left.updatedAt;
      });
    const attentionWorkItems = activeWorkItems
      .filter((item) => workItemAttentionRank(item, nowMs) < 4)
      .slice(0, 8)
      .map((item) => toHomeWorkItem(item, projectsById.get(item.projectId)?.name ?? 'Project'));
    const currentWorkItems = activeWorkItems
      .slice(0, 30)
      .map((item) => toHomeWorkItem(item, projectsById.get(item.projectId)?.name ?? 'Project'));
    const recentlyCompletedWorkItems = allWorkItems.items
      .filter((item) => item.status === 'done')
      .sort((left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt))
      .slice(0, 8)
      .map((item) => toHomeWorkItem(item, projectsById.get(item.projectId)?.name ?? 'Project'));

    const activeWorkflowRuns = workflowRuns
      .filter((run) => run.status === 'queued' || run.status === 'running')
      .slice(0, 5)
      .map(toHomeWorkflowRun);
    const attentionWorkflowRuns = workflowRuns
      .filter((run) => run.status === 'failed' || run.status === 'timeout')
      .slice(0, 5)
      .map(toHomeWorkflowRun);
    const recentWorkflowRuns = workflowRuns.slice(0, 5).map(toHomeWorkflowRun);
    const upcomingAutomations = automations
      .map(toHomeAutomation)
      .filter((automation): automation is HomeAutomation => Boolean(automation))
      .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
      .slice(0, 5);
    const latestAutomationRuns = [...automationRuns]
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .filter((run, index, all) => all.findIndex((candidate) => candidate.automationId === run.automationId) === index);
    const decisions: HomeDecision[] = [
      ...activeWorkItems
        .map((item) => decisionFromWorkItem(item, projectsById.get(item.projectId)?.name ?? 'Project', nowMs))
        .filter((item): item is HomeDecision => Boolean(item)),
      ...activeGoals
        .map((goal) => decisionFromGoal(goal, goal.projectId ? projectsById.get(goal.projectId)?.name : undefined))
        .filter((item): item is HomeDecision => Boolean(item)),
      ...attentionWorkflowRuns.map((run): HomeDecision => ({
        id: `workflow:${run.id}`,
        kind: 'workflow_run',
        title: run.title,
        detail: run.status,
        reason: 'run_failed',
        urgency: 'now',
        href: `/workflows?runId=${encodeURIComponent(run.id)}`,
        updatedAt: run.completedAtMs ?? run.startedAtMs ?? run.createdAtMs,
      })),
      ...latestAutomationRuns
        .filter((run) => run.status === 'failed' || run.status === 'timeout')
        .map((run): HomeDecision => ({
          id: `automation:${run.id}`,
          kind: 'automation_run',
          title: run.automationName || run.automationId,
          detail: run.error || run.summary,
          reason: 'run_failed',
          urgency: 'now',
          href: '/automations',
          updatedAt: run.endedAtMs ?? run.startedAtMs ?? run.createdAtMs,
        })),
      ...connectorApprovals
        .filter((approval) => Date.parse(approval.expiresAt) > nowMs)
        .map((approval): HomeDecision => ({
          id: `connector-approval:${approval.id}`,
          kind: 'connector_approval',
          title: approval.actionId,
          detail: `${approval.connectorId} · ${approval.scope}`,
          reason: 'approval_required',
          urgency: 'now',
          href: '/connectors',
          updatedAt: Date.parse(approval.createdAt),
          response: { kind: 'connector_approval', approvalId: approval.id },
        })),
      ...activeGoals.flatMap((goal) => goal.evidenceRequirements
        .filter((requirement) => requirement.requiresHumanApproval
          && requirement.evidenceIds.length > 0
          && (requirement.status === 'pending' || requirement.status === 'ai_verified'))
        .map((requirement): HomeDecision => ({
          id: `goal-evidence:${requirement.id}`,
          kind: 'goal_evidence',
          title: goal.title,
          detail: requirement.text,
          reason: 'approval_required',
          urgency: 'now',
          href: `/goals/${encodeURIComponent(goal.id)}`,
          projectId: goal.projectId,
          projectName: goal.projectId ? projectsById.get(goal.projectId)?.name : undefined,
          updatedAt: requirement.updatedAt,
          response: { kind: 'goal_evidence', goalId: goal.id, requirementId: requirement.id },
        }))),
    ]
      .sort((left, right) => {
        const urgency = (left.urgency === 'now' ? 0 : 1) - (right.urgency === 'now' ? 0 : 1);
        return urgency || right.updatedAt - left.updatedAt;
      })
      .slice(0, 20);
    const wins: HomeBriefingWin[] = [
      ...recentlyCompletedWorkItems.map((item): HomeBriefingWin => ({
        id: `work:${item.id}`,
        kind: 'work_item',
        title: item.title,
        href: `/work-items/${encodeURIComponent(item.id)}`,
        completedAt: item.completedAt ?? item.updatedAt,
      })),
      ...workflowRuns
        .filter((run) => run.status === 'succeeded')
        .map((run): HomeBriefingWin => ({
          id: `workflow:${run.id}`,
          kind: 'workflow_run',
          title: run.title,
          href: `/workflows?runId=${encodeURIComponent(run.id)}`,
          completedAt: run.completedAtMs ?? run.createdAtMs,
        })),
      ...latestAutomationRuns
        .filter((run) => run.status === 'succeeded')
        .map((run): HomeBriefingWin => ({
          id: `automation:${run.id}`,
          kind: 'automation_run',
          title: run.automationName || run.automationId,
          href: '/automations',
          completedAt: run.endedAtMs ?? run.createdAtMs,
        })),
    ].sort((left, right) => right.completedAt - left.completedAt);
    const briefing = buildHomeBriefing({
      locale: c.req.query('locale'),
      decisions,
      activeWorkCount: activeWorkItems.filter((item) => item.status === 'in_progress').length,
      activeWorkflowCount: activeWorkflowRuns.length,
      activeGoalCount: activeGoals.filter((goal) => goal.status === 'active').length,
      wins,
      nextScheduled: upcomingAutomations[0],
      nowMs,
    });

    return c.json({
      recentlyOpened: recentlyOpened.items.filter((n) => n.lastOpenedAt),
      inboxCount: inbox.total,
      pendingTasks: pendingTasks.items,
      pendingTaskCount: pendingTasks.total,
      recentSessions: recentSessions.items,
      activeAgent: defaultAgent
        ? {
            id: defaultAgent.id,
            name: defaultAgent.name,
            description: defaultAgent.description,
          }
        : { id: agents.defaultId },
      gateway: {
        status: health.status,
        ready: health.ready,
        httpListening: health.httpListening,
        version: health.version,
        uptime: health.uptime,
        tunnel: {
          state: tunnel.state,
          publicUrl: tunnel.publicUrl,
          connected: tunnel.state === 'connected',
        },
      },
      workflowRuns: {
        active: activeWorkflowRuns,
        attention: attentionWorkflowRuns,
        recent: recentWorkflowRuns,
      },
      briefing,
      decisions,
      proactiveInsights,
      calendarSignals,
      work: {
        attentionCount: activeWorkItems.filter((item) => workItemAttentionRank(item, nowMs) < 3).length,
        overdueCount: activeWorkItems.filter((item) => item.dueAt != null && item.dueAt < nowMs).length,
        todayCount: activeWorkItems.filter((item) => item.dueAt != null && item.dueAt >= nowMs && item.dueAt < nowMs + 24 * 60 * 60 * 1000).length,
        items: attentionWorkItems,
        current: currentWorkItems,
        recentlyCompleted: recentlyCompletedWorkItems,
      },
      upcomingAutomations,
      recentAutomationRuns: automationRuns.slice(0, 5).map(toHomeAutomationRun),
    });
  });

  authenticated.post('/api/home/decisions/respond', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'deny' ? 'deny' : undefined;
    if (!decision) return c.json({ ok: false, error: 'Decision must be approve or deny' }, 400);
    if (body.kind === 'connector_approval' && typeof body.approvalId === 'string') {
      const approval = decideConnectorApproval(body.approvalId, decision === 'approve' ? 'approved' : 'denied');
      if (!approval) return c.json({ ok: false, error: 'Approval not found' }, 404);
      if (approval.status !== (decision === 'approve' ? 'approved' : 'denied')) {
        return c.json({ ok: false, error: `Approval is ${approval.status}` }, 409);
      }
      return c.json({ ok: true, status: approval.status });
    }
    if (body.kind === 'goal_evidence' && typeof body.goalId === 'string' && typeof body.requirementId === 'string') {
      const goal = goals.get(body.goalId);
      const requirement = goal?.evidenceRequirements.find((item) => item.id === body.requirementId);
      if (!goal || !requirement) return c.json({ ok: false, error: 'Evidence approval not found' }, 404);
      if (requirement.evidenceIds.length === 0) return c.json({ ok: false, error: 'Evidence is missing' }, 409);
      const updated = goals.reviewEvidenceRequirement({
        goalId: goal.id,
        requirementId: requirement.id,
        status: decision === 'approve' ? 'approved' : 'rejected',
        reason: decision === 'approve' ? 'Approved from the decision inbox.' : 'Rejected from the decision inbox.',
        reviewedBy: 'user',
      });
      return c.json({ ok: true, status: updated?.status });
    }
    return c.json({ ok: false, error: 'Unsupported decision kind' }, 400);
  });
}
