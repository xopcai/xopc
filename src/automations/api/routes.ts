import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from '../../gateway/hono/routes/deps.js';
import { logRouteError } from '../../gateway/hono/lib/route-logger.js';
import { createLogger } from '../../utils/logger.js';
import { AutomationAlreadyRunningError } from '../service/automation-service.js';

const log = createLogger('Gateway:Automations');

function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function registerAutomationRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.get('/api/automations', async (c) => {
    const automations = await service.automationServiceInstance.list();
    return c.json({ automations });
  });

  authenticated.post('/api/automations', async (c) => {
    try {
      const body = await c.req.json();
      const automation = await service.automationServiceInstance.create(body);
      return c.json({ automation }, 201);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'create' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create automation' }, 400);
    }
  });

  authenticated.get('/api/automations/metrics', async (c) => {
    const metrics = await service.automationServiceInstance.getMetrics();
    return c.json(metrics);
  });

  authenticated.get('/api/automation-runs', async (c) => {
    const automationId = c.req.query('automationId')?.trim();
    const runs = await service.automationServiceInstance.listRuns({
      automationId: automationId || undefined,
      limit: parseLimit(c.req.query('limit'), 50),
    });
    return c.json({ runs });
  });

  authenticated.get('/api/automation-runs/:runId', async (c) => {
    const run = await service.automationServiceInstance.getRun(c.req.param('runId'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json({ run });
  });

  authenticated.post('/api/automation-runs/:runId/cancel', async (c) => {
    const cancelled = await service.automationServiceInstance.cancelRun(c.req.param('runId'));
    return c.json({ cancelled });
  });

  authenticated.get('/api/automations/:id', async (c) => {
    const automation = await service.automationServiceInstance.get(c.req.param('id'));
    if (!automation) return c.json({ error: 'Automation not found' }, 404);
    return c.json({ automation });
  });

  authenticated.patch('/api/automations/:id', async (c) => {
    try {
      const automation = await service.automationServiceInstance.update(c.req.param('id'), await c.req.json());
      if (!automation) return c.json({ error: 'Automation not found' }, 404);
      return c.json({ automation });
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'update' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update automation' }, 400);
    }
  });

  authenticated.delete('/api/automations/:id', async (c) => {
    const removed = await service.automationServiceInstance.remove(c.req.param('id'));
    return c.json({ removed });
  });

  authenticated.post('/api/automations/:id/run', async (c) => {
    try {
      const run = await service.automationServiceInstance.runNow(c.req.param('id'));
      return c.json({ run });
    } catch (err) {
      if (err instanceof AutomationAlreadyRunningError) {
        return c.json({
          error: err.message,
          code: 'automation_already_running',
          automationId: err.automationId,
          runningRunId: err.runningRunId,
        }, 409);
      }
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'run' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to run automation' }, 400);
    }
  });

  authenticated.post('/api/automations/:id/pause', async (c) => {
    const automation = await service.automationServiceInstance.pause(c.req.param('id'));
    if (!automation) return c.json({ error: 'Automation not found' }, 404);
    return c.json({ automation });
  });

  authenticated.post('/api/automations/:id/resume', async (c) => {
    const automation = await service.automationServiceInstance.resume(c.req.param('id'));
    if (!automation) return c.json({ error: 'Automation not found' }, 404);
    return c.json({ automation });
  });
}
