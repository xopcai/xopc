import type { WorkHomeResponse } from '@xopcai/gateway-contract';

import { listGatewayAgents } from '../gateway/agents-admin.js';
import { getTunnelService } from '../tunnel/index.js';
import {
  DEFAULT_AUTOMATION_TIMEOUT_SECONDS,
  type Automation,
  type AutomationRun,
} from '../automations/index.js';
import type { AutomationService } from '../automations/service/automation-service.js';
import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import type { ProactiveInboxService } from '../proactive/inbox/service.js';
import type { ProjectService } from '../projects/project-service.js';
import type { SessionIndex } from '../session/manager.js';
import {
  isHomeAttentionAcknowledged,
  getRelationshipSettings,
  listConnectorApprovals,
  type HomeAttentionSubjectKind,
} from '../storage/sqlite/index.js';
import type { WorkflowRunSummary } from '../workflows/domain/index.js';
import type { WorkflowRunService } from '../workflows/service/workflow-run-service.js';
import { WorkItemService } from '../work-items/index.js';
import { OutcomeReceiptService } from './outcome-receipt-service.js';
import { OutcomeRepository } from './outcome-repository.js';
import { AttentionGovernor } from './attention-governor.js';
import { OutcomeExecutionStateRepository, type OutcomeExecutionState } from './outcome-execution-state.js';

type HomeDecision = WorkHomeResponse['decisions'][number];
type HomeAttention = WorkHomeResponse['attention'][number];
type HomeBriefingWin = WorkHomeResponse['briefing']['wins'][number];
type HomeAutomation = WorkHomeResponse['upcomingAutomations'][number];

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

type HomeSnapshot = WorkHomeResponse & {
  recentlyOpened: unknown[];
  inboxCount: number;
  pendingTasks: unknown[];
  pendingTaskCount: number;
  recentSessions: unknown[];
  activeAgent: { id: string; name?: string; description?: string };
  gateway: Record<string, unknown>;
  recentAutomationRuns: HomeAutomationRun[];
};

interface WorkHomeGatewayPort {
  readonly notesServiceInstance: NotesService;
  readonly sessions: Pick<SessionIndex, 'listSessions'> & {
    getActiveRun(sessionKey: string): { active: boolean; runId?: string };
  };
  readonly currentConfig: Config;
  readonly automationServiceInstance: AutomationService;
  readonly projects: ProjectService;
  readonly proactiveInbox: ProactiveInboxService;
  createWorkflowRunService(): WorkflowRunService;
  getHealth(): {
    status: string;
    ready: boolean;
    httpListening: boolean;
    version: string;
    uptime: number;
  };
}

export function workItemAttentionRank(
  item: { status: string; dueAt?: number; priority: string; updatedAt: number },
  nowMs: number,
): number {
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
    status: WorkHomeResponse['work']['current'][number]['status'];
    priority: WorkHomeResponse['work']['current'][number]['priority'];
    nextAction?: string;
    blockedReason?: string;
    dueAt?: number;
    completedAt?: number;
    updatedAt: number;
  },
  projectName: string,
) {
  return { ...item, projectName };
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

export function decisionFromOutcome(
  outcome: { id: string; objective: string; internalStatus: string; updatedAt: number },
  execution: OutcomeExecutionState,
  projectName?: string,
): HomeDecision | null {
  if (outcome.internalStatus !== 'needs_user' && outcome.internalStatus !== 'blocked') return null;
  return {
    id: `outcome:${outcome.id}`,
    kind: 'outcome',
    title: outcome.objective,
    detail: execution.blockedReason || execution.nextAction,
    reason: outcome.internalStatus === 'needs_user' ? 'needs_input' : 'blocked',
    urgency: 'now',
    href: `/work/${encodeURIComponent(outcome.id)}`,
    projectId: execution.projectId,
    projectName,
    updatedAt: Math.max(outcome.updatedAt, execution.updatedAt),
  };
}

function decisionFromWorkItem(
  item: Parameters<typeof toHomeWorkItem>[0],
  projectName: string,
  nowMs: number,
): HomeDecision | null {
  let reason: HomeDecision['reason'] | undefined;
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
  activeOutcomeCount: number;
  wins: HomeBriefingWin[];
  nextScheduled?: HomeAutomation;
  nowMs: number;
}) {
  const isChinese = input.locale?.toLowerCase().startsWith('zh') ?? false;
  const movingCount = input.activeWorkCount + input.activeWorkflowCount + input.activeOutcomeCount;
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
      activeOutcomeCount: input.activeOutcomeCount,
      movingCount,
    },
    wins: input.wins.slice(0, 5),
    nextScheduled: input.nextScheduled,
  };
}

export class WorkHomeQueryService {
  readonly #executions = new OutcomeExecutionStateRepository();
  readonly #receipts = new OutcomeReceiptService();
  readonly #outcomes = new OutcomeRepository();
  readonly #attentionGovernor = new AttentionGovernor();

  constructor(private readonly service: WorkHomeGatewayPort) {}

  async getSnapshot(locale?: string): Promise<HomeSnapshot> {
    const notes = this.service.notesServiceInstance;
    const sessions = this.service.sessions;
    const agents = await listGatewayAgents(this.service.currentConfig);
    const defaultAgent = agents.agents.find((agent) => agent.id === agents.defaultId) ?? agents.agents[0];
    const workflowRunStore = this.service.createWorkflowRunService()
      .createRunStore(defaultAgent?.id ?? agents.defaultId);
    const tunnel = getTunnelService().getStatus();
    const health = this.service.getHealth();
    const workItems = new WorkItemService();
    const nowMs = Date.now();
    const outcomes = this.#outcomes.list({ limit: 60 });

    const [recentlyOpened, inbox, pendingTasks, recentSessions, workflowRuns, automations,
      automationRuns, projects, allWorkItems, connectorApprovals] = await Promise.all([
      notes.listNotes({ sortBy: 'lastOpenedAt', sortOrder: 'desc', limit: 10 }),
      notes.listNotes({ status: 'inbox', limit: 0 }),
      notes.listNotes({ pendingTasksOnly: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 10 }),
      sessions.listSessions({ channel: 'webchat', sortBy: 'updatedAt', sortOrder: 'desc', limit: 50 }),
      workflowRunStore.listRunSummaries(20),
      this.service.automationServiceInstance.list(),
      this.service.automationServiceInstance.listRuns({ limit: 10 }),
      this.service.projects.list({ limit: 500 }),
      Promise.resolve(workItems.listWorkItems({ limit: 100 })),
      Promise.resolve(listConnectorApprovals({ principalId: 'local-owner', status: 'pending', limit: 100 })),
    ]);
    const executionsByOutcomeId = new Map(this.#executions.list(100).map((execution) => [execution.outcomeId, execution]));
    const activeOutcomes = outcomes.filter((outcome) => outcome.internalStatus !== 'completed' && outcome.internalStatus !== 'cancelled');
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
    const proactiveJudgments = this.service.proactiveInbox.list({ limit: 20 })
      .filter((item) => item.status === 'unread' || item.status === 'read');
    const decisionCandidates: HomeDecision[] = [
      ...proactiveJudgments.map((item): HomeDecision => ({
        id: `agent-judgment:${item.id}`,
        kind: 'agent_judgment',
        title: item.insight.title,
        detail: item.insight.summary,
        reason: 'decision_needed',
        urgency: item.insight.urgency === 'critical' || item.insight.urgency === 'high' ? 'now' : 'soon',
        href: `/work?judgment=${encodeURIComponent(item.id)}`,
        updatedAt: Date.parse(item.updatedAt),
        judgment: {
          inboxItemId: item.id,
          whyNow: item.insight.whyNow,
          impact: item.insight.impact,
          workDone: item.insight.workDone,
          recommendation: item.insight.recommendation,
          confidence: item.insight.confidence,
          valueScore: item.insight.valueScore,
          ...(item.insight.decision ? { decision: item.insight.decision } : {}),
        },
      })),
      ...activeWorkItems
        .map((item) => decisionFromWorkItem(item, projectsById.get(item.projectId)?.name ?? 'Project', nowMs))
        .filter((item): item is HomeDecision => Boolean(item)),
      ...activeOutcomes
        .map((outcome) => {
          const execution = executionsByOutcomeId.get(outcome.id);
          return execution
            ? decisionFromOutcome(outcome, execution, execution.projectId ? projectsById.get(execution.projectId)?.name : undefined)
            : null;
        })
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
    ];

    const attentionCandidates: HomeAttention[] = [
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
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    const governed = this.#attentionGovernor.project({
      decisions: decisionCandidates,
      attention: attentionCandidates,
      proactiveEnabled: getRelationshipSettings().proactiveEnabled,
    });
    const decisions = governed.decisions;
    const attention = governed.attention;

    const wins: HomeBriefingWin[] = [
      ...recentlyCompletedWorkItems.map((item): HomeBriefingWin => ({
        id: `work:${item.id}`,
        kind: 'work_item',
        title: item.title,
        href: `/work-items/${encodeURIComponent(item.id)}`,
        completedAt: item.completedAt ?? item.updatedAt,
      })),
      ...workflowRuns.filter((run) => run.status === 'succeeded').map((run): HomeBriefingWin => ({
        id: `workflow:${run.id}`,
        kind: 'workflow_run',
        title: run.title,
        href: `/workflows?runId=${encodeURIComponent(run.id)}`,
        completedAt: run.completedAtMs ?? run.createdAtMs,
      })),
      ...latestAutomationRuns.filter((run) => run.status === 'succeeded').map((run): HomeBriefingWin => ({
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
      activeOutcomeCount: activeOutcomes.length,
      wins,
      nextScheduled: upcomingAutomations[0],
      nowMs,
    });

    return {
      recentlyOpened: recentlyOpened.items.filter((note) => note.lastOpenedAt),
      inboxCount: inbox.total,
      pendingTasks: pendingTasks.items,
      pendingTaskCount: pendingTasks.total,
      recentSessions: recentSessions.items.slice(0, 5),
      activeAgent: defaultAgent
        ? { id: defaultAgent.id, name: defaultAgent.name, description: defaultAgent.description }
        : { id: agents.defaultId },
      gateway: {
        status: health.status,
        ready: health.ready,
        httpListening: health.httpListening,
        version: health.version,
        uptime: health.uptime,
        tunnel: { state: tunnel.state, publicUrl: tunnel.publicUrl, connected: tunnel.state === 'connected' },
      },
      workflowRuns: { active: activeWorkflowRuns, recent: recentWorkflowRuns },
      briefing,
      decisions,
      attention,
      attentionPolicy: governed.policy,
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
      outcomes: {
        running: outcomes.filter((outcome) => outcome.userStatus === 'running').slice(0, 20),
        needsUser: outcomes.filter((outcome) => outcome.userStatus === 'needs_user').slice(0, 20),
        recentlyCompleted: outcomes.filter((outcome) => outcome.userStatus === 'completed').slice(0, 10),
      },
      recentOutcomes: this.#receipts.list({ limit: 20 })
        .filter((receipt) => receipt.status !== 'running')
        .slice(0, 8),
      recentAutomationRuns: automationRuns.slice(0, 5).map(toHomeAutomationRun),
    };
  }
}
