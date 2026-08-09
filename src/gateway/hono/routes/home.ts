import type { Hono } from 'hono';

import { listGatewayAgents } from '../../agents-admin.js';
import { getTunnelService } from '../../../tunnel/index.js';
import {
  DEFAULT_AUTOMATION_TIMEOUT_SECONDS,
  type Automation,
  type AutomationRun,
} from '../../../automations/index.js';
import { GoalService, type GoalWithDetails } from '../../../goals/index.js';
import {
  acknowledgeHomeAttention,
  decideConnectorApproval,
  isHomeAttentionAcknowledged,
  listConnectorApprovals,
  type HomeAttentionSubjectKind,
} from '../../../storage/sqlite/index.js';
import type { WorkflowRunSummary } from '../../../workflows/domain/index.js';
import { WorkItemService } from '../../../work-items/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

type HomeDecisionKind = 'work_item' | 'goal' | 'connector_approval' | 'goal_evidence';
type HomeDecisionReason =
  | 'needs_input'
  | 'in_review'
  | 'blocked'
  | 'overdue'
  | 'due_soon'
  | 'approval_required';

type HomeAttention = {
  id: string;
  kind: HomeAttentionSubjectKind;
  runId: string;
  title: string;
  detail: string;
  reason: 'run_failed' | 'run_timeout';
  href: string;
  updatedAt: number;
  sessionKey?: string;
};

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
  if (automation.action.kind === 'browser_recipe') return `browser-workflow:${automation.action.recipeId}`;
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

function effectiveAutomationTimeoutSeconds(run: AutomationRun, automation?: Automation): number {
  return run.actionSnapshot.timeoutSeconds
    ?? automation?.reliability?.timeoutSeconds
    ?? DEFAULT_AUTOMATION_TIMEOUT_SECONDS;
}

function attentionDetail(
  kind: HomeAttentionSubjectKind,
  status: 'failed' | 'timeout',
  locale: string | undefined,
  timeoutSeconds?: number,
): string {
  const isChinese = locale?.toLowerCase().startsWith('zh') ?? false;
  if (status === 'timeout') {
    const seconds = timeoutSeconds ?? DEFAULT_AUTOMATION_TIMEOUT_SECONDS;
    const duration = seconds % 60 === 0
      ? `${seconds / 60} ${isChinese ? '分钟' : seconds === 60 ? 'minute' : 'minutes'}`
      : `${seconds} ${isChinese ? '秒' : seconds === 1 ? 'second' : 'seconds'}`;
    return isChinese
      ? `运行超过 ${duration}，系统已停止本次执行。`
      : `The run exceeded ${duration} and was stopped.`;
  }
  if (isChinese) return kind === 'automation_run' ? '自动化未能完成，请查看详情后重试。' : '工作流未能完成，请查看详情后重试。';
  return kind === 'automation_run'
    ? 'The automation did not complete. Review the details and retry.'
    : 'The workflow did not complete. Review the details and retry.';
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
  attention: HomeAttention[];
  activeWorkCount: number;
  activeWorkflowCount: number;
  activeGoalCount: number;
  wins: HomeBriefingWin[];
  nextScheduled?: HomeAutomation;
  nowMs: number;
}) {
  const isChinese = input.locale?.toLowerCase().startsWith('zh') ?? false;
  const movingCount = input.activeWorkCount + input.activeWorkflowCount + input.activeGoalCount;
  const attentionCount = input.decisions.length + input.attention.length;
  const summary = attentionCount > 0
    ? isChinese
      ? movingCount > 0
        ? `有 ${attentionCount} 件事需要你处理；我正在继续推进 ${movingCount} 件工作。`
        : `有 ${attentionCount} 件事需要你处理。`
      : movingCount > 0
        ? `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} your attention; I’m continuing ${movingCount} in the background.`
        : `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} your attention.`
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
 *   - workflowRuns: active and recent workflow runs
 *   - upcomingAutomations: upcoming enabled automations
 *   - recentAutomationRuns: latest automation executions
 */
export function registerHomeRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const goals = new GoalService();

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
    ] = await Promise.all([
      notes.listNotes({ sortBy: 'lastOpenedAt', sortOrder: 'desc', limit: 10 }),
      notes.listNotes({ status: 'inbox', limit: 0 }),
      notes.listNotes({ pendingTasksOnly: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 10 }),
      sessions.listSessions({ channel: 'webchat', sortBy: 'updatedAt', sortOrder: 'desc', limit: 50 }),
      workflowRunStore.listRunSummaries(20),
      service.automationServiceInstance.list(),
      service.automationServiceInstance.listRuns({ limit: 10 }),
      service.projects.list({ limit: 500 }),
      Promise.resolve(workItems.listWorkItems({ limit: 100 })),
      Promise.resolve(goals.list({ status: ['active', 'blocked', 'needs_input', 'paused'], limit: 100 })),
      Promise.resolve(listConnectorApprovals({ principalId: 'local-owner', status: 'pending', limit: 100 })),
    ]);
    const projectsById = new Map(projects.items.map((project) => [project.id, project]));
    const workChats = recentSessions.items
      .filter((session) => (session.messageCount ?? 0) > 0)
      .map((session) => ({
        key: session.key,
        name: session.name || 'Conversation',
        updatedAt: session.updatedAt,
        active: sessions.getActiveRun(session.key).active,
      }));
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
    const failedWorkflowRuns = workflowRuns
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
    const automationsById = new Map(automations.map((automation) => [automation.id, automation]));
    const decisions: HomeDecision[] = [
      ...activeWorkItems
        .map((item) => decisionFromWorkItem(item, projectsById.get(item.projectId)?.name ?? 'Project', nowMs))
        .filter((item): item is HomeDecision => Boolean(item)),
      ...activeGoals
        .map((goal) => decisionFromGoal(goal, goal.projectId ? projectsById.get(goal.projectId)?.name : undefined))
        .filter((item): item is HomeDecision => Boolean(item)),
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
    const locale = c.req.query('locale');
    const attention: HomeAttention[] = [
      ...failedWorkflowRuns
        .filter((run) => !isHomeAttentionAcknowledged('workflow_run', run.id))
        .map((run): HomeAttention => ({
          id: `workflow_run:${run.id}`,
          kind: 'workflow_run',
          runId: run.id,
          title: run.title,
          detail: attentionDetail('workflow_run', run.status === 'timeout' ? 'timeout' : 'failed', locale),
          reason: run.status === 'timeout' ? 'run_timeout' : 'run_failed',
          href: `/workflows?runId=${encodeURIComponent(run.id)}`,
          updatedAt: run.completedAtMs ?? run.startedAtMs ?? run.createdAtMs,
          sessionKey: run.sessionKey,
        })),
      ...latestAutomationRuns
        .filter((run) => run.status === 'failed' || run.status === 'timeout')
        .filter((run) => !isHomeAttentionAcknowledged('automation_run', run.id))
        .map((run): HomeAttention => ({
          id: `automation_run:${run.id}`,
          kind: 'automation_run',
          runId: run.id,
          title: run.automationName || run.automationId,
          detail: attentionDetail(
            'automation_run',
            run.status === 'timeout' ? 'timeout' : 'failed',
            locale,
            effectiveAutomationTimeoutSeconds(run, automationsById.get(run.automationId)),
          ),
          reason: run.status === 'timeout' ? 'run_timeout' : 'run_failed',
          href: `/automations?run=${encodeURIComponent(run.id)}`,
          updatedAt: run.endedAtMs ?? run.startedAtMs ?? run.createdAtMs,
          sessionKey: run.sessionKey,
        })),
    ]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 10);
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
      locale,
      decisions,
      attention,
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
      recentSessions: recentSessions.items.slice(0, 5),
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
        recent: recentWorkflowRuns,
      },
      briefing,
      decisions,
      attention,
      chats: {
        running: workChats.filter((chat) => chat.active),
        recent: workChats.filter((chat) => !chat.active).slice(0, 8),
      },
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

  authenticated.post('/api/home/attention/acknowledge', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const kind = body.kind === 'automation_run' || body.kind === 'workflow_run' ? body.kind : undefined;
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    if (!kind || !runId) return c.json({ ok: false, error: 'kind and runId are required' }, 400);
    acknowledgeHomeAttention(kind, runId);
    return c.json({ ok: true, status: 'acknowledged' });
  });

  authenticated.post('/api/home/attention/retry', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const kind = body.kind === 'automation_run' || body.kind === 'workflow_run' ? body.kind : undefined;
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    if (!kind || !runId) return c.json({ ok: false, error: 'kind and runId are required' }, 400);

    if (kind === 'automation_run') {
      try {
        const run = await service.automationServiceInstance.rerunFromRun(runId);
        acknowledgeHomeAttention(kind, runId);
        return c.json({ ok: true, runId: run.id }, 202);
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to retry automation' }, 400);
      }
    }

    const agents = await listGatewayAgents(service.currentConfig);
    const agentId = agents.defaultId;
    const result = await service.createWorkflowRunService().retryWorkflowRun({ agentId, runId });
    if (result.ok === false) return c.json({ ok: false, error: result.message, code: result.code }, result.httpStatus);
    acknowledgeHomeAttention(kind, runId);
    return c.json({ ok: true, runId: result.runId, sessionKey: result.sessionKey }, 202);
  });
}
