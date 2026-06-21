import type { Hono } from 'hono';

import { listGatewayAgents } from '../../agents-admin.js';
import { getTunnelService } from '../../../tunnel/index.js';
import type { JobWithNextRun, CronRunHistoryRow } from '../../../cron/types.js';
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

type HomeCronJob = {
  id: string;
  name?: string;
  schedule: string;
  nextRunAt: string;
  payloadKind: string;
};

type HomeCronRun = {
  id: string;
  jobId: string;
  jobName?: string;
  status: CronRunHistoryRow['status'];
  startedAt: string;
  endedAt?: string;
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

function payloadKind(job: JobWithNextRun): string {
  const payload = job.payload as { kind?: unknown } | undefined;
  return typeof payload?.kind === 'string' ? payload.kind : 'unknown';
}

function toHomeCronJob(job: JobWithNextRun): HomeCronJob | null {
  if (!job.enabled || !job.next_run) return null;
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    nextRunAt: job.next_run,
    payloadKind: payloadKind(job),
  };
}

function toHomeCronRun(run: CronRunHistoryRow): HomeCronRun {
  return {
    id: run.id,
    jobId: run.jobId,
    jobName: run.jobName,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
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
 *   - nextCronJobs: upcoming enabled schedules
 *   - recentCronRuns: latest cron executions
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
      cronJobs,
      recentCronRuns,
    ] = await Promise.all([
      notes.listNotes({ sortBy: 'lastOpenedAt', sortOrder: 'desc', limit: 10 }),
      notes.listNotes({ status: 'inbox', limit: 0 }),
      notes.listNotes({ pendingTasksOnly: true, sortBy: 'createdAt', sortOrder: 'desc', limit: 10 }),
      sessions.listSessions({ sortBy: 'updatedAt', sortOrder: 'desc', limit: 5 }),
      workflowRunStore.listRunSummaries(20),
      service.cronServiceInstance.listJobs(),
      service.cronServiceInstance.getAllRunsHistory(10),
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
    const nextCronJobs = cronJobs
      .map(toHomeCronJob)
      .filter((job): job is HomeCronJob => Boolean(job))
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
      nextCronJobs,
      recentCronRuns: recentCronRuns.slice(0, 5).map(toHomeCronRun),
    });
  });
}
