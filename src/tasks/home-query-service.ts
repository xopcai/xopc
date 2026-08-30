import type {
  HomeAction,
  HomeAttention,
  HomeDecision,
  HomeResponse,
  HomeWorkbenchItem,
} from '@xopcai/gateway-contract';

import { listGatewayAgents } from '../gateway/agents-admin.js';
import {
  DEFAULT_AUTOMATION_TIMEOUT_SECONDS,
  type Automation,
  type AutomationRun,
} from '../automations/index.js';
import type { AutomationService } from '../automations/service/automation-service.js';
import type { Config } from '../config/schema.js';
import type { ProactiveInboxService } from '../proactive/inbox/service.js';
import type { ProjectService } from '../projects/project-service.js';
import {
  isHomeAttentionAcknowledged,
  getRelationshipSettings,
  listConnectorApprovals,
  type HomeAttentionSubjectKind,
} from '../storage/sqlite/index.js';
import type { WorkflowRunSummary } from '../workflows/domain/index.js';
import type { WorkflowRunService } from '../workflows/service/workflow-run-service.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskReadModelProjector, type TaskReadModel } from './task-read-model-projector.js';
import { AttentionGovernor } from './attention-governor.js';

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

interface HomeGatewayPort {
  readonly currentConfig: Config;
  readonly automationServiceInstance: AutomationService;
  readonly projects: ProjectService;
  readonly proactiveInbox: ProactiveInboxService;
  readonly sessions: {
    listActiveRuns(): Array<{ sessionKey: string; runId: string }>;
    getSession(key: string): Promise<{
      name?: string;
      updatedAt: string;
      lastInteractionAt?: string;
      routing?: { agentId?: string };
    } | null>;
  };
  createWorkflowRunService(): WorkflowRunService;
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
  if (automation.action.kind === 'task_command') return `task:${automation.action.command.type}`;
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

function effectiveAutomationTimeoutSeconds(run: AutomationRun, automation?: Automation): number {
  return ('timeoutSeconds' in run.actionSnapshot ? run.actionSnapshot.timeoutSeconds : undefined)
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

export function decisionFromTask(
  model: TaskReadModel,
  projectName?: string,
  locale?: string,
): HomeDecision | null {
  const task = model.task;
  const isChinese = locale?.toLowerCase().startsWith('zh') ?? task.locale === 'zh';
  if (task.phase === 'review') {
    return {
      id: `task:${task.id}:review`,
      kind: 'task',
      title: task.title,
      detail: isChinese ? '执行已经完成，正在等待你验收结果。' : 'The work is complete and ready for your review.',
      reason: 'decision_needed',
      urgency: 'now',
      href: `/tasks/${encodeURIComponent(task.id)}`,
      projectId: task.projectId,
      projectName,
      dueAt: task.dueAt,
      updatedAt: task.updatedAt,
    };
  }

  const item = model.attention.find((candidate) => [
    'input_required',
    'approval_required',
    'run_failed',
    'verification_failed',
    'overdue',
  ].includes(candidate.kind));
  if (!item) return null;
  const reason = item.kind === 'input_required'
    ? 'needs_input'
    : item.kind === 'approval_required'
      ? 'approval_required'
      : item.kind === 'run_failed' || item.kind === 'verification_failed'
        ? 'retry'
        : item.kind === 'overdue'
          ? 'overdue'
          : undefined;
  if (!reason) return null;
  return {
    id: `task:${task.id}`,
    kind: 'task',
    title: task.title,
    detail: item.summary,
    reason,
    urgency: 'now',
    href: `/tasks/${encodeURIComponent(task.id)}`,
    projectId: task.projectId,
    projectName,
    dueAt: task.dueAt,
    updatedAt: task.updatedAt,
  };
}

function homeActionCopy(locale?: string) {
  const isChinese = locale?.toLowerCase().startsWith('zh') ?? false;
  return isChinese
    ? {
        approve: '允许并继续',
        deny: '拒绝',
        review: '查看并处理',
        retry: '重试',
        acknowledge: '暂时忽略',
        viewProgress: '查看进度',
        viewSchedule: '查看计划',
        runningTask: '任务正在推进',
        runningWorkflow: '工作流正在推进',
        scheduled: '下一项定时工作',
        inputRecommendation: '建议补充所需信息，让工作继续推进。',
        approvalRecommendation: '建议先确认操作范围；符合预期后允许本次操作。',
        reviewRecommendation: '建议查看结果，确认符合预期后完成验收。',
        retryRecommendation: '建议先重试；如果再次失败，再检查执行详情。',
      }
    : {
        approve: 'Allow and continue',
        deny: 'Deny',
        review: 'Review',
        retry: 'Retry',
        acknowledge: 'Dismiss',
        viewProgress: 'View progress',
        viewSchedule: 'View schedule',
        runningTask: 'Task in progress',
        runningWorkflow: 'Workflow in progress',
        scheduled: 'Next scheduled work',
        inputRecommendation: 'Provide the missing information so the work can continue.',
        approvalRecommendation: 'Confirm the operation scope, then allow it if it matches your intent.',
        reviewRecommendation: 'Review the result and accept it if it meets your expectations.',
        retryRecommendation: 'Retry once; inspect the run details if it fails again.',
      };
}

function formatScheduleDistance(value: string, nowMs: number, locale?: string): string {
  const distanceMs = Math.max(0, Date.parse(value) - nowMs);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  const minutes = Math.max(1, Math.ceil(distanceMs / 60_000));
  if (minutes < 60) return formatter.format(minutes, 'minute');
  const hours = Math.ceil(distanceMs / 3_600_000);
  if (hours < 48) return formatter.format(hours, 'hour');
  return formatter.format(Math.ceil(distanceMs / 86_400_000), 'day');
}

function decisionRecommendation(decision: HomeDecision, copy: ReturnType<typeof homeActionCopy>): string {
  if (decision.judgment?.recommendation) return decision.judgment.recommendation;
  if (decision.reason === 'needs_input' || decision.reason === 'user_input') return copy.inputRecommendation;
  if (decision.reason === 'approval_required' || decision.reason === 'user_approval') return copy.approvalRecommendation;
  if (decision.reason === 'retry') return copy.retryRecommendation;
  return copy.reviewRecommendation;
}

export function buildHomeWorkbench(input: {
  locale?: string;
  decisions: HomeDecision[];
  attention: HomeAttention[];
  activeWorkflowRuns: HomeWorkflowRun[];
  runningTasks: TaskAggregate[];
  scheduled: HomeAutomation[];
  nowMs: number;
}): Pick<HomeResponse, 'needsUser' | 'background' | 'backgroundCount'> {
  const copy = homeActionCopy(input.locale);
  const decisions = input.decisions.map((decision): HomeWorkbenchItem => {
    const openAction: HomeAction = decision.kind === 'agent_judgment' && decision.judgment
      ? { type: 'review_judgment', label: copy.review, itemId: decision.judgment.inboxItemId }
      : { type: 'open', label: copy.review, href: decision.href };
    const connectorActions = decision.response?.kind === 'connector_approval'
      ? {
          primaryAction: {
            type: 'connector_decision' as const,
            label: copy.approve,
            approvalId: decision.response.approvalId,
            decision: 'approve' as const,
          },
          secondaryActions: [{
            type: 'connector_decision' as const,
            label: copy.deny,
            approvalId: decision.response.approvalId,
            decision: 'deny' as const,
          }],
        }
      : { primaryAction: openAction, secondaryActions: [] };
    return {
      id: decision.id,
      kind: 'decision',
      title: decision.title,
      summary: decision.detail || copy.review,
      recommendation: decisionRecommendation(decision, copy),
      dueAt: decision.dueAt,
      updatedAt: decision.updatedAt,
      openAction,
      ...connectorActions,
    };
  });
  const failures = input.attention.map((item): HomeWorkbenchItem => ({
    id: item.id,
    kind: 'failure',
    title: item.title,
    summary: item.detail,
    recommendation: copy.retryRecommendation,
    updatedAt: item.updatedAt,
    openAction: { type: 'open', label: copy.review, href: item.href },
    primaryAction: {
      type: 'retry_run',
      label: copy.retry,
      subjectKind: item.kind,
      runId: item.runId,
    },
    secondaryActions: [{
      type: 'acknowledge_run',
      label: copy.acknowledge,
      subjectKind: item.kind,
      runId: item.runId,
    }],
  }));
  const workflows = input.activeWorkflowRuns.map((run): HomeWorkbenchItem => {
    const openAction: HomeAction = {
      type: 'open',
      label: copy.viewProgress,
      href: run.sessionKey
        ? `/chat/${encodeURIComponent(run.sessionKey)}`
        : `/workflows?runId=${encodeURIComponent(run.id)}`,
    };
    return {
      id: `workflow:${run.id}`,
      kind: 'running',
      title: run.title,
      summary: copy.runningWorkflow,
      statusLabel: run.metrics.agentCount > 0
        ? `${run.metrics.doneAgentCount}/${run.metrics.agentCount}`
        : undefined,
      updatedAt: run.startedAtMs ?? run.createdAtMs,
      openAction,
      secondaryActions: [],
    };
  });
  const tasks = input.runningTasks.map((task): HomeWorkbenchItem => {
    const openAction: HomeAction = {
      type: 'open',
      label: copy.viewProgress,
      href: `/tasks/${encodeURIComponent(task.id)}`,
    };
    return {
      id: `task:${task.id}`,
      kind: 'running',
      title: task.title,
      summary: copy.runningTask,
      updatedAt: task.updatedAt,
      openAction,
      secondaryActions: [],
    };
  });
  const scheduled = input.scheduled.map((automation): HomeWorkbenchItem => ({
    id: `automation:${automation.id}:scheduled`,
    kind: 'scheduled',
    title: automation.name || automation.id,
    summary: copy.scheduled,
    statusLabel: formatScheduleDistance(automation.nextRunAt, input.nowMs, input.locale),
    updatedAt: Date.parse(automation.nextRunAt),
    openAction: { type: 'open', label: copy.viewSchedule, href: `/automations?automation=${encodeURIComponent(automation.id)}` },
    secondaryActions: [],
  }));
  const urgencyById = new Map(input.decisions.map((decision) => [decision.id, decision.urgency]));
  decisions.sort((left, right) => {
    const leftUrgency = urgencyById.get(left.id) === 'now' ? 1 : 0;
    const rightUrgency = urgencyById.get(right.id) === 'now' ? 1 : 0;
    return rightUrgency - leftUrgency || right.updatedAt - left.updatedAt;
  });
  failures.sort((left, right) => right.updatedAt - left.updatedAt);
  const needsUser = [...decisions, ...failures];
  const allBackground = [...workflows, ...tasks, ...scheduled];
  return {
    needsUser,
    background: allBackground.slice(0, 3),
    backgroundCount: allBackground.length,
  };
}

export class HomeQueryService {
  readonly #tasks = new TaskRepository();
  readonly #projector = new TaskReadModelProjector();
  readonly #attentionGovernor = new AttentionGovernor();

  constructor(private readonly service: HomeGatewayPort) {}

  async getSnapshot(locale?: string): Promise<HomeResponse> {
    const agents = await listGatewayAgents(this.service.currentConfig);
    const defaultAgent = agents.agents.find((agent) => agent.id === agents.defaultId) ?? agents.agents[0];
    const workflowRunStore = this.service.createWorkflowRunService()
      .createRunStore(defaultAgent?.id ?? agents.defaultId);
    const nowMs = Date.now();
    const tasks = this.#tasks.list({ limit: 60 });
    const activeRuns = this.service.sessions.listActiveRuns();

    const [workflowRuns, automations, automationRuns, projects, connectorApprovals, activeRunSessions] = await Promise.all([
      workflowRunStore.listRunSummaries(20),
      this.service.automationServiceInstance.list(),
      this.service.automationServiceInstance.listRuns({ limit: 10 }),
      this.service.projects.list({ limit: 500 }),
      Promise.resolve(listConnectorApprovals({ principalId: 'local-owner', status: 'pending', limit: 100 })),
      Promise.all(activeRuns.map(async (run) => ({
        ...run,
        session: await this.service.sessions.getSession(run.sessionKey),
      }))),
    ]);
    const runningConversations = activeRunSessions
      .filter((item) => Boolean(item.session))
      .map((item) => {
        const session = item.session!;
        const updatedAt = Date.parse(session.lastInteractionAt ?? session.updatedAt);
        return {
          sessionKey: item.sessionKey,
          runId: item.runId,
          ...(session.name?.trim() ? { title: session.name.trim() } : {}),
          ...(session.routing?.agentId ? { agentId: session.routing.agentId } : {}),
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : nowMs,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const activeTasks = tasks.filter((task) => task.phase !== 'closed');
    const projectsById = new Map(projects.items.map((project) => [project.id, project]));
    const activeWorkflowRuns = workflowRuns
      .filter((run) => run.status === 'queued' || run.status === 'running')
      .map(toHomeWorkflowRun);
    const failedWorkflowRuns = workflowRuns
      .filter((run) => run.status === 'failed' || run.status === 'timeout')
      .slice(0, 5)
      .map(toHomeWorkflowRun);
    const upcomingAutomations = automations
      .filter((automation) => automation.notificationPolicy !== 'none')
      .map(toHomeAutomation)
      .filter((automation): automation is HomeAutomation => Boolean(automation))
      .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
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
        reason: item.insight.disposition === 'request_approval' ? 'approval_required' : 'decision_needed',
        urgency: item.insight.urgency === 'critical' || item.insight.urgency === 'high' ? 'now' : 'soon',
        href: `/?judgment=${encodeURIComponent(item.id)}`,
        updatedAt: Date.parse(item.updatedAt),
        judgment: {
          inboxItemId: item.id,
          whyNow: item.insight.whyNow,
          impact: item.insight.impact,
          workDone: item.insight.workDone,
          recommendation: item.insight.recommendation,
          confidence: item.insight.confidence,
          valueScore: item.insight.valueScore,
          disposition: item.insight.disposition,
          dispositionReason: item.insight.dispositionReason,
          ...(item.insight.actionStatus ? { actionStatus: item.insight.actionStatus } : {}),
          ...(item.insight.proposedAction ? { proposedActionTitle: item.insight.proposedAction.input.title } : {}),
          ...(item.insight.actionError ? { actionError: item.insight.actionError } : {}),
          ...(item.insight.decision && (!item.insight.proposedAction || item.insight.actionStatus === 'approval_required')
            ? { decision: item.insight.decision }
            : {}),
        },
      })),
      ...activeTasks
        .map((task) => decisionFromTask(
          this.#projector.project(task),
          task.projectId ? projectsById.get(task.projectId)?.name : undefined,
          locale,
        ))
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
        .filter((run) => automationsById.get(run.automationId)?.notificationPolicy !== 'none')
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

    const runningTasks = tasks.filter((task) => {
      const state = this.#projector.project(task).operationalState;
      return state === 'queued' || state === 'running' || state === 'verifying';
    });
    const workbench = buildHomeWorkbench({
      locale,
      decisions,
      attention,
      activeWorkflowRuns,
      runningTasks,
      scheduled: upcomingAutomations,
      nowMs,
    });

    return {
      ...workbench,
      runningConversations,
      decisions,
      attentionPolicy: governed.policy,
    };
  }
}
