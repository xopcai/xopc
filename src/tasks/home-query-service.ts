import type {
  HomeAction,
  HomeAttention,
  HomeAdvisor,
  HomeDecision,
  HomeDelivery,
  HomeResponse,
  HomeResumeItem,
  HomeWorkbenchItem,
} from '@xopcai/gateway-contract';


import {
  DEFAULT_AUTOMATION_TIMEOUT_SECONDS,
  type Automation,
  type AutomationRun,
} from '../automations/index.js';
import type { AutomationService } from '../automations/service/automation-service.js';
import type { Config } from '../config/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import {
  isHomeAttentionAcknowledged,
  listConnectorApprovals,
  listSessionMetadata,
  type HomeAttentionSubjectKind,
} from '../storage/sqlite/index.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { TaskReadModelProjector, type TaskReadModel } from './task-read-model-projector.js';
import { AttentionGovernor, compareHomeDecisions } from './attention-governor.js';
import { stripMarkdown } from '../voice/tts/preprocess.js';

const RECENT_WORK_MS = 7 * 24 * 60 * 60_000;
const DELIVERY_HISTORY_LIMIT = 30;

function deliverySummary(summary: string): string {
  return stripMarkdown(summary).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function automationRunHref(run: AutomationRun): string {
  return `/automations?automation=${encodeURIComponent(run.automationId)}&view=run&run=${encodeURIComponent(run.id)}`;
}

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
  readonly sessions: {
    listActiveRuns(): Array<{ conversationId: string; runId: string }>;
    getSession(key: string): Promise<{
      name?: string;
      updatedAt: string;
      lastInteractionAt?: string;
      routing?: { agentId?: string };
    } | null>;
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

  if (automation.action.kind === 'task_command') return `task:${automation.action.command.type}`;
  if (automation.action.kind === 'system') return `system:${automation.action.capability}`;
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
    ?? automation?.reliability?.executionTimeoutSeconds
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
  return isChinese ? '自动化未能完成，请查看详情后重试。' : 'The automation did not complete. Review the details and retry.';
}

export function decisionFromTask(
  model: TaskReadModel,
  projectName?: string,
  locale?: string,
): HomeDecision | null {
  const task = model.task;
  if (task.phase === 'closed' || (model.operationalState === 'waiting' && model.attention.length === 0)) return null;
  const isChinese = locale?.toLowerCase().startsWith('zh') ?? task.locale === 'zh';
  const waitingAttention = model.attention.some((item) => ['input_required', 'approval_required', 'dependency_blocked'].includes(item.kind));
  if (task.phase === 'review' && !waitingAttention) {
    return {
      id: `task:${task.id}:review`,
      response: { kind: 'task', taskId: task.id, canRetry: false },
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
    'dependency_blocked',
    'run_failed',
    'verification_failed',
    'overdue',
  ].includes(candidate.kind));
  if (!item) return null;
  const reason = item.kind === 'input_required'
    ? 'needs_input'
    : item.kind === 'approval_required'
      ? 'approval_required'
      : item.kind === 'dependency_blocked' ? 'dependency'
      : item.kind === 'run_failed' || item.kind === 'verification_failed'
        ? 'retry'
        : item.kind === 'overdue'
          ? 'overdue'
          : undefined;
  if (!reason) return null;
  return {
    id: `task:${task.id}`,
    response: { kind: 'task', taskId: task.id, canRetry: reason === 'retry' && model.allowedCommands.includes('start') },
    kind: 'task',
    title: task.title,
    detail: isChinese ? ({
      'Agent run returned no result or evidence': '本次执行没有返回结果或依据，请重试。',
      'The latest run failed': '最近一次执行失败，请查看详情后重试。',
      'Assistant response was truncated before completion': '回复未完整生成，可查看已有结果或重试。',
      'Task is overdue': '任务已逾期。',
    } as Record<string, string>)[item.summary] ?? item.summary : item.summary,
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
        reviewResult: '查看结果并验收',
        retry: '重试',
        acknowledge: '移除本次提醒',
        viewProgress: '查看进度',
        viewSchedule: '查看计划',
        runningTask: '任务正在推进',
        waitingTask: '等待条件',
        pausedTask: '已暂停',
        pausedByUser: '已由你暂停',
        viewPausedTask: '查看并恢复',
        dependencyRecommendation: '先查看并处理依赖任务，再继续推进。',
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
        reviewResult: 'Review result',
        retry: 'Retry',
        acknowledge: 'Remove this alert',
        viewProgress: 'View progress',
        viewSchedule: 'View schedule',
        runningTask: 'Task in progress',
        waitingTask: 'Waiting',
        pausedTask: 'Paused',
        pausedByUser: 'Paused by you',
        viewPausedTask: 'Review and resume',
        dependencyRecommendation: 'Resolve the dependency before continuing.',
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
  if (decision.reason === 'needs_input' || decision.reason === 'user_input') return copy.inputRecommendation;
  if (decision.reason === 'approval_required' || decision.reason === 'user_approval') return copy.approvalRecommendation;
  if (decision.reason === 'dependency') return copy.dependencyRecommendation;
  if (decision.reason === 'retry') return copy.retryRecommendation;
  return copy.reviewRecommendation;
}

export function buildHomeWorkbench(input: {
  locale?: string;
  decisions: HomeDecision[];
  attention: HomeAttention[];
  runningTasks: TaskAggregate[];
  waitingTaskReasons?: Record<string, string>;
  pausedTaskIds?: ReadonlySet<string>;
  scheduled: HomeAutomation[];
  nowMs: number;
}): Pick<HomeResponse, 'needsUser' | 'background' | 'backgroundCount'> {
  const copy = homeActionCopy(input.locale);
  const decisions = [...input.decisions].sort((a, b) => compareHomeDecisions(a, b, input.nowMs)).map((decision): HomeWorkbenchItem => {
    const openAction: HomeAction = { type: 'open', label: copy.review, href: decision.href };
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
      projectName: decision.projectName,
      recommendation: decisionRecommendation(decision, copy),
      dueAt: decision.dueAt,
      updatedAt: decision.updatedAt,
      openAction,
      ...(decision.response?.kind === 'task' && decision.reason === 'decision_needed'
        ? {
            primaryAction: { type: 'task_review' as const, label: copy.reviewResult, taskId: decision.response.taskId },
            secondaryActions: [openAction],
          }
        : decision.response?.kind === 'task' && decision.response.canRetry
          ? {
              primaryAction: { type: 'retry_task' as const, label: copy.retry, taskId: decision.response.taskId },
              secondaryActions: [openAction],
            }
          : connectorActions),
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
  const tasks = input.runningTasks.map((task): HomeWorkbenchItem => {
    const reason = input.waitingTaskReasons?.[task.id];
    const paused = input.pausedTaskIds?.has(task.id);
    const openAction: HomeAction = {
      type: 'open',
      label: paused ? copy.viewPausedTask : copy.viewProgress,
      href: `/tasks/${encodeURIComponent(task.id)}`,
    };
    return {
      id: `task:${task.id}`,
      kind: 'running',
      title: task.title,
      summary: paused && reason === 'Paused by user' ? copy.pausedByUser : reason ?? (paused ? copy.pausedTask : copy.runningTask),
      ...(paused ? { backgroundState: 'paused', statusLabel: copy.pausedTask } : reason ? { backgroundState: 'waiting', statusLabel: copy.waitingTask } : {}),
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
  failures.sort((left, right) => right.updatedAt - left.updatedAt);
  const needsUser = [...decisions, ...failures];
  const allBackground = [...tasks, ...scheduled];
  return {
    needsUser,
    background: allBackground,
    backgroundCount: allBackground.length,
  };
}

export class HomeQueryService {
  readonly #tasks = new TaskRepository();
  readonly #runs = new TaskRunRepository();
  readonly #projector = new TaskReadModelProjector();
  readonly #attentionGovernor = new AttentionGovernor();

  constructor(
    private readonly service: HomeGatewayPort,
    private readonly getAdvisor: (locale?: string) => HomeAdvisor = () => ({ state: 'quiet', reason: 'no_change' }),
  ) {}

  async getSnapshot(locale?: string, includeAll = false): Promise<HomeResponse> {
    const nowMs = Date.now();
    const activeTasks: TaskAggregate[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = this.#tasks.list({ excludeClosed: true, limit: 200, offset });
      activeTasks.push(...page);
      if (page.length < 200) break;
    }
    const activeRuns = this.service.sessions.listActiveRuns();
    const [automations, automationRuns, projects, connectorApprovals, activeRunSessions] = await Promise.all([
      this.service.automationServiceInstance.list(),
      this.service.automationServiceInstance.listRuns({ limit: 200 }),
      this.service.projects.list({ limit: 500 }),
      Promise.resolve(listConnectorApprovals({ principalId: 'local-owner', status: 'pending', limit: 100 })),
      Promise.all(activeRuns.map(async (run) => ({
        ...run,
        session: await this.service.sessions.getSession(run.conversationId),
      }))),
    ]);
    const linkedConversations = new Set(automationRuns.flatMap((run) => run.conversationId ? [run.conversationId] : []));
    if (activeRuns.length) {
      for (const task of activeTasks) {
        const run = this.#runs.getActiveRoot(task.id);
        if (run?.conversationId) linkedConversations.add(run.conversationId);
      }
    }
    const runningConversations = activeRunSessions
      .filter((item) => item.session && !linkedConversations.has(item.conversationId))
      .map((item) => {
        const session = item.session!;
        const updatedAt = Date.parse(session.lastInteractionAt ?? session.updatedAt);
        return {
          conversationId: item.conversationId,
          runId: item.runId,
          ...(session.name?.trim() ? { title: session.name.trim() } : {}),
          ...(session.routing?.agentId ? { agentId: session.routing.agentId } : {}),
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : nowMs,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const models = activeTasks.map((task) => this.#projector.project(task, nowMs));
    const projectsById = new Map(projects.items.map((project) => [project.id, project]));
    const upcomingAutomations = automations
      .filter((automation) => automation.delivery.notificationPolicy !== 'none')
      .map(toHomeAutomation)
      .filter((automation): automation is HomeAutomation => Boolean(automation))
      .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
    const automationsById = new Map(automations.map((automation) => [automation.id, automation]));
    const visibleRuns = automationRuns.filter((run) =>
      automationsById.has(run.automationId) && automationsById.get(run.automationId)?.delivery.notificationPolicy !== 'none');
    const latestAutomationRuns = new Map<string, AutomationRun>();
    for (const run of visibleRuns) {
      const current = latestAutomationRuns.get(run.automationId);
      if (!current || current.createdAtMs < run.createdAtMs) latestAutomationRuns.set(run.automationId, run);
    }
    const decisionCandidates: HomeDecision[] = [
      ...models
        .map((model) => decisionFromTask(
          model,
          model.task.projectId ? projectsById.get(model.task.projectId)?.name : undefined,
          locale,
        ))
        .filter((item): item is HomeDecision => Boolean(item)),
      ...connectorApprovals
        .filter((approval) => Date.parse(approval.expiresAt) > nowMs)
        .map((approval): HomeDecision => ({
          id: `connector-approval:${approval.id}`,
          kind: 'connector_approval',
          title: approval.actionId,
          detail: `${approval.connectorId} · ${approval.scope}\n${JSON.stringify(approval.argumentsPreview).slice(0, 1600)}`,
          reason: 'approval_required',
          urgency: 'now',
          dueAt: Date.parse(approval.expiresAt),
          href: approval.conversationId ? `/chat/${encodeURIComponent(approval.conversationId)}` : '/connectors',
          updatedAt: Date.parse(approval.createdAt),
          response: { kind: 'connector_approval', approvalId: approval.id },
        })),
    ];

    const attentionCandidates: HomeAttention[] = [
      ...[...latestAutomationRuns.values()]
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
          conversationId: run.conversationId,
        })),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    const governed = this.#attentionGovernor.project({
      includeAll,
      decisions: decisionCandidates,
      attention: attentionCandidates,
      nowMs,
    });
    const decisions = governed.decisions;
    const attention = governed.attention;

    const waitingTaskReasons: Record<string, string> = {};
    const pausedTaskIds = new Set<string>();
    const runningTasks = models.filter((model) => {
      const task = model.task;
      if (model.operationalState === 'waiting' && model.attention.length === 0) {
        const waits = this.#runs.listActiveWaits(task.id);
        const pause = waits.find((wait) => wait.kind === 'paused');
        if (pause) pausedTaskIds.add(task.id);
        waitingTaskReasons[task.id] = (pause ?? waits[0])?.reason
          ?? homeActionCopy(locale).waitingTask;
        return true;
      }
      return ['allocating', 'queued', 'running', 'verifying'].includes(model.operationalState);
    }).map((model) => model.task);
    const workbench = buildHomeWorkbench({
      locale,
      decisions,
      attention,
      runningTasks,
      waitingTaskReasons,
      pausedTaskIds,
      scheduled: upcomingAutomations,
      nowMs,
    });
    const copy = homeActionCopy(locale);
    const runningAutomations: HomeWorkbenchItem[] = visibleRuns
      .filter((run) => ['queued', 'running', 'cancelling'].includes(run.status))
      .map((run) => ({
        id: `automation_run:${run.id}`, kind: 'running', title: run.automationName || run.automationId,
        summary: copy.runningTask, updatedAt: run.startedAtMs ?? run.createdAtMs,
        openAction: { type: 'open', label: copy.viewProgress, href: automationRunHref(run) }, secondaryActions: [],
      }));
    return {
      ...workbench,
      background: [...runningAutomations, ...workbench.background],
      backgroundCount: runningAutomations.length + workbench.backgroundCount,
      runningConversations,
      recentDeliveries: this.recentDeliveries(visibleRuns),
      resumable: this.resumableWork(models, decisionCandidates, projectsById, activeRuns, nowMs),
      decisions,
      advisor: this.getAdvisor(locale),
      attentionPolicy: governed.policy,
    };
  }

  private recentDeliveries(automationRuns: AutomationRun[]): HomeDelivery[] {
    const deliveries: HomeDelivery[] = [];
    for (const task of this.#tasks.list({ phase: 'closed', limit: 100 })) {
      if (task.resolution !== 'done') continue;
      const run = this.#runs.getLatestRoot(task.id);
      if (!run || run.contractVersion !== task.latestContractVersion) continue;
      const receipt = this.#runs.getReceipt(run.id);
      if (!receipt || receipt.status !== 'succeeded' || (!receipt.summary.trim() && !receipt.evidence.length)) continue;
      deliveries.push({
        id: `task:${run.id}`, kind: 'task', subjectId: task.id, title: task.title,
        summary: deliverySummary(receipt.summary), completedAt: receipt.finalizedAt, read: task.contract?.acceptancePolicy === 'manual',
        href: `/tasks/${encodeURIComponent(task.id)}`,
      });
    }
    for (const run of automationRuns) {
      if (run.status !== 'succeeded' || !run.endedAtMs || (!run.summary?.trim() && !run.conversationId)) continue;
      deliveries.push({
        id: `automation:${run.id}`, kind: 'automation', subjectId: run.id, title: run.automationName || run.automationId,
        summary: deliverySummary(run.summary ?? ''), completedAt: run.endedAtMs, read: run.readAtMs !== undefined,
        href: automationRunHref(run),
      });
    }
    return deliveries.sort((a, b) => b.completedAt - a.completedAt).slice(0, DELIVERY_HISTORY_LIMIT);
  }

  private resumableWork(
    models: TaskReadModel[],
    decisions: HomeDecision[],
    projects: Map<string, { name: string }>,
    activeRuns: Array<{ conversationId: string }>,
    now: number,
  ): HomeResumeItem[] {
    const cutoff = now - RECENT_WORK_MS;
    const decisionIds = new Set(decisions.flatMap((item) => item.response?.kind === 'task' ? [item.response.taskId] : []));
    const runningIds = new Set(activeRuns.map((item) => item.conversationId));
    const resumable: HomeResumeItem[] = [];
    for (const { task, operationalState, allowedCommands } of models) {
      if (task.updatedAt < cutoff || decisionIds.has(task.id) || operationalState !== 'idle' || !allowedCommands.includes('start')) continue;
      resumable.push({
        id: task.id, kind: 'task', title: task.title, summary: task.contract?.objective,
        projectName: task.projectId ? projects.get(task.projectId)?.name : undefined,
        updatedAt: task.updatedAt, href: `/tasks/${encodeURIComponent(task.id)}`,
      });
    }
    for (const session of listSessionMetadata({
      limit: 20, excludeArchived: true, excludeAutomationRuns: true, rootConversationsOnly: true,
      activity: 'manual', updatedAfter: cutoff,
    }).items) {
      const updatedAt = Date.parse(session.lastInteractionAt ?? session.updatedAt);
      if (!session.messageCount || !session.name?.trim() || updatedAt < cutoff || runningIds.has(session.key)) continue;
      resumable.push({
        id: session.key, kind: 'conversation', title: session.name,
        projectName: session.projectId ? projects.get(session.projectId)?.name : undefined,
        updatedAt, href: `/chat/${encodeURIComponent(session.key)}`,
      });
    }
    return resumable.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  }
}
