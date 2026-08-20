import type { HomeResponse } from '@xopcai/gateway-contract';

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
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { TaskReadModelProjector, type TaskReadModel } from './task-read-model-projector.js';
import { AttentionGovernor } from './attention-governor.js';

type HomeDecision = HomeResponse['decisions'][number];
type HomeAttention = HomeResponse['attention'][number];
type HomeBriefingWin = HomeResponse['briefing']['wins'][number];
type HomeAutomation = HomeResponse['upcomingAutomations'][number];

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

type HomeSnapshot = HomeResponse & {
  recentlyOpened: unknown[];
  inboxCount: number;
  pendingTasks: unknown[];
  pendingTaskCount: number;
  recentSessions: unknown[];
  activeAgent: { id: string; name?: string; description?: string };
  gateway: Record<string, unknown>;
  recentAutomationRuns: HomeAutomationRun[];
};

interface HomeGatewayPort {
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
): HomeDecision | null {
  const item = model.attention[0];
  if (!item || !['input_required', 'approval_required', 'dependency_blocked'].includes(item.kind)) return null;
  const task = model.task;
  return {
    id: `task:${task.id}`,
    kind: 'task',
    title: task.title,
    detail: item.summary,
    reason: item.kind === 'input_required' ? 'needs_input' : 'blocked',
    urgency: 'now',
    href: `/tasks/${encodeURIComponent(task.id)}`,
    projectId: task.projectId,
    projectName,
    updatedAt: task.updatedAt,
  };
}

export function buildHomeBriefing(input: {
  locale?: string;
  decisions: HomeDecision[];
  attention: HomeAttention[];
  activeWorkflowCount: number;
  activeTaskCount: number;
  wins: HomeBriefingWin[];
  nextScheduled?: HomeAutomation;
  nowMs: number;
}) {
  const isChinese = input.locale?.toLowerCase().startsWith('zh') ?? false;
  const movingCount = input.activeWorkflowCount + input.activeTaskCount;
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
        : 'Nothing is moving yet today. Hand me an task and I’ll take it from here.';
  return {
    generatedAt: input.nowMs,
    summary,
    focus: input.decisions.slice(0, 3),
    progress: {
      activeWorkflowCount: input.activeWorkflowCount,
      activeTaskCount: input.activeTaskCount,
      movingCount,
    },
    wins: input.wins.slice(0, 5),
    nextScheduled: input.nextScheduled,
  };
}

export class HomeQueryService {
  readonly #runs = new TaskRunRepository();
  readonly #tasks = new TaskRepository();
  readonly #projector = new TaskReadModelProjector();
  readonly #attentionGovernor = new AttentionGovernor();

  constructor(private readonly service: HomeGatewayPort) {}

  async getSnapshot(locale?: string): Promise<HomeSnapshot> {
    const notes = this.service.notesServiceInstance;
    const sessions = this.service.sessions;
    const agents = await listGatewayAgents(this.service.currentConfig);
    const defaultAgent = agents.agents.find((agent) => agent.id === agents.defaultId) ?? agents.agents[0];
    const workflowRunStore = this.service.createWorkflowRunService()
      .createRunStore(defaultAgent?.id ?? agents.defaultId);
    const tunnel = getTunnelService().getStatus();
    const health = this.service.getHealth();
    const nowMs = Date.now();
    const tasks = this.#tasks.list({ limit: 60 });

    const [recentlyOpened, inbox, pendingTasks, recentSessions, workflowRuns, automations,
      automationRuns, projects, connectorApprovals] = await Promise.all([
      notes.listNotes({ sortBy: 'lastOpenedAt', sortOrder: 'desc', limit: 10 }),
      notes.listNotes({ status: 'inbox', limit: 0 }),
      notes.listNotes({ pendingTasksOnly: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 10 }),
      sessions.listSessions({ channel: 'webchat', sortBy: 'updatedAt', sortOrder: 'desc', limit: 50 }),
      workflowRunStore.listRunSummaries(20),
      this.service.automationServiceInstance.list(),
      this.service.automationServiceInstance.listRuns({ limit: 10 }),
      this.service.projects.list({ limit: 500 }),
      Promise.resolve(listConnectorApprovals({ principalId: 'local-owner', status: 'pending', limit: 100 })),
    ]);
    const activeTasks = tasks.filter((task) => task.phase !== 'closed');
    const projectsById = new Map(projects.items.map((project) => [project.id, project]));
    const workChats = recentSessions.items
      .filter((session) => (session.messageCount ?? 0) > 0)
      .map((session) => ({
        key: session.key,
        name: session.name || 'Conversation',
        updatedAt: session.updatedAt,
        active: sessions.getActiveRun(session.key).active,
      }));
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
          ...(item.insight.decision ? { decision: item.insight.decision } : {}),
        },
      })),
      ...activeTasks
        .map((task) => decisionFromTask(
          this.#projector.project(task),
          task.projectId ? projectsById.get(task.projectId)?.name : undefined,
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
      activeWorkflowCount: activeWorkflowRuns.length,
      activeTaskCount: activeTasks.length,
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
      upcomingAutomations,
      tasks: {
        running: tasks.filter((task) => {
          const state = this.#projector.project(task).operationalState;
          return state === 'queued' || state === 'running' || state === 'verifying';
        }).slice(0, 20),
      },
      recentTasks: tasks.flatMap((task) => this.#runs.listReceipts(task.id, 3))
        .sort((a, b) => b.finalizedAt - a.finalizedAt).slice(0, 8),
      recentAutomationRuns: automationRuns.slice(0, 5).map(toHomeAutomationRun),
    };
  }
}
