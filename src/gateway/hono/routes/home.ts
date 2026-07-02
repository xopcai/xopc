import type { Hono } from 'hono';

import { listGatewayAgents } from '../../agents-admin.js';
import { getTunnelService } from '../../../tunnel/index.js';
import type { Automation, AutomationRun } from '../../../automations/index.js';
import type { WorkflowRunSummary } from '../../../workflows/domain/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

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

/**
 * GET /api/home — Aggregated home screen data for the mobile app.
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

  authenticated.get('/api/home', async (c) => {
    const notes = service.notesServiceInstance;
    const sessions = service.sessions;
    const agents = await listGatewayAgents(service.currentConfig);
    const defaultAgent = agents.agents.find((agent) => agent.id === agents.defaultId) ?? agents.agents[0];
    const workflowRunService = service.createWorkflowRunService();
    const workflowRunStore = workflowRunService.createRunStore(defaultAgent?.id ?? agents.defaultId);
    const tunnel = getTunnelService().getStatus();
    const health = service.getHealth();

    const [
      recentlyOpened,
      inbox,
      pendingTasks,
      recentSessions,
      workflowRuns,
      automations,
      automationRuns,
    ] = await Promise.all([
      notes.listNotes({ sortBy: 'lastOpenedAt', sortOrder: 'desc', limit: 10 }),
      notes.listNotes({ status: 'inbox', limit: 0 }),
      notes.listNotes({ pendingTasksOnly: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 10 }),
      sessions.listSessions({ sortBy: 'updatedAt', sortOrder: 'desc', limit: 5 }),
      workflowRunStore.listRunSummaries(20),
      service.automationServiceInstance.list(),
      service.automationServiceInstance.listRuns({ limit: 10 }),
    ]);

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
      upcomingAutomations,
      recentAutomationRuns: automationRuns.slice(0, 5).map(toHomeAutomationRun),
    });
  });
}
