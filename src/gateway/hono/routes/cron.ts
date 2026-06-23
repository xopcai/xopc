import type { Hono } from 'hono';

import { CronJobAlreadyRunningError } from '../../../cron/service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';

const log = createGatewayRouteLogger('Cron');

export function registerCronRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  // ========== Cron REST API (/api/cron) ==========

  // GET /api/cron - List all jobs
  authenticated.get('/api/cron', async (c) => {
    const jobs = await service.cronServiceInstance.listJobs();
    return c.json({ jobs });
  });

  // POST /api/cron - Add new job
  authenticated.post('/api/cron', async (c) => {
    const body = await c.req.json();
    const { schedule, name, description, sessionTarget, wakeMode, agentId, workingDirectory, delivery, payload, failureAlert, deleteAfterRun } = body;

    if (!schedule || !payload) {
      return c.json({ error: 'Missing required fields: schedule, payload' }, 400);
    }

    try {
      const result = await service.cronServiceInstance.addJob(schedule, {
        name,
        description,
        sessionTarget,
        wakeMode,
        ...(typeof agentId === 'string' && agentId.trim() ? { agentId: agentId.trim() } : {}),
        ...(typeof workingDirectory === 'string' && workingDirectory.trim()
          ? { workingDirectory: workingDirectory.trim() }
          : {}),
        ...(typeof deleteAfterRun === 'boolean' ? { deleteAfterRun } : {}),
        delivery,
        failureAlert,
        payload,
      });
      return c.json(result, 201);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.cron', { operation: 'addJob' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to add job' }, 400);
    }
  });

  // GET /api/cron/metrics - Get cron metrics (must be before /:id)
  authenticated.get('/api/cron/metrics', async (c) => {
    const metrics = await service.cronServiceInstance.getMetrics();
    return c.json(metrics);
  });

  // GET /api/cron/runs/history - Recent runs across all jobs (must be before /:id)
  authenticated.get('/api/cron/runs/history', async (c) => {
    const raw = c.req.query('limit');
    const limit = raw ? parseInt(raw, 10) : 50;
    const runs = await service.cronServiceInstance.getAllRunsHistory(Number.isFinite(limit) ? limit : 50);
    return c.json({ runs });
  });

  // GET /api/cron/:id - Get single job (must be after /metrics)
  authenticated.get('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const job = await service.cronServiceInstance.getJob(id);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }
    return c.json({ job });
  });

  // POST /api/cron/:id/toggle - Toggle job enabled
  authenticated.post('/api/cron/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'Missing required field: enabled' }, 400);
    }

    const result = await service.cronServiceInstance.toggleJob(id, enabled);
    return c.json({ toggled: result });
  });

  // POST /api/cron/:id/run - Trigger job manually
  authenticated.post('/api/cron/:id/run', async (c) => {
    const id = c.req.param('id');

    try {
      const result = await service.cronServiceInstance.runJobNow(id);
      return c.json({ triggered: true, job: result.job, history: result.history });
    } catch (err) {
      if (err instanceof CronJobAlreadyRunningError) {
        log.info(
          { jobId: err.jobId, runningSessionKey: err.runningSessionKey },
          'Cron job run requested while already running',
        );
        return c.json(
          {
            error: err.message,
            code: 'job_already_running',
            jobId: err.jobId,
            runningSessionKey: err.runningSessionKey,
          },
          409,
        );
      }
      logRouteError(log, c, err, 'gateway.route.cron', { operation: 'runJob' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to run job' }, 400);
    }
  });

  // GET /api/cron/:id/history - Get job execution history
  authenticated.get('/api/cron/:id/history', async (c) => {
    const id = c.req.param('id');
    const raw = c.req.query('limit');
    const limit = raw ? parseInt(raw, 10) : 10;
    const history = await service.cronServiceInstance.getJobHistory(id, Number.isFinite(limit) ? limit : 10);
    return c.json({ history });
  });

  // PATCH /api/cron/:id - Update job
  authenticated.patch('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();

    try {
      const result = await service.cronServiceInstance.updateJob(id, body);
      return c.json({ updated: result });
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.cron', { operation: 'updateJob' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update job' }, 400);
    }
  });

  // DELETE /api/cron/:id - Remove job
  authenticated.delete('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const result = await service.cronServiceInstance.removeJob(id);
    return c.json({ removed: result });
  });
}
