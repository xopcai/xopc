import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../agent/agent-scope.js';
import type { AuthenticatedRouteDeps } from '../../gateway/hono/routes/deps.js';
import { logRouteError } from '../../gateway/hono/lib/route-logger.js';
import { createLogger } from '../../utils/logger.js';
import { AutomationDraftService, simulateAutomation } from '../draft/index.js';
import type { CreateAutomationInput } from '../domain/validation.js';
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

  authenticated.post('/api/automations/draft', async (c) => {
    const body = await c.req.json().catch(() => null) as {
      prompt?: unknown;
      agentId?: unknown;
      language?: unknown;
    } | null;
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return c.json({ error: 'prompt is required' }, 400);
    const agentId = typeof body?.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : resolveDefaultAgentId(service.currentConfig);
    const draftService = new AutomationDraftService({ config: service.currentConfig });
    try {
      const draft = await draftService.createDraft({
        prompt,
        agentId,
        language: body?.language === 'zh' ? 'zh' : 'en',
      }, c.req.raw.signal);
      return c.json({ draft }, 201);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'draft' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create automation draft' }, 400);
    }
  });

  authenticated.post('/api/automations/simulate', async (c) => {
    try {
      const body = await c.req.json() as CreateAutomationInput;
      return c.json({ simulation: simulateAutomation(body) });
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'simulate' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to simulate automation' }, 400);
    }
  });

  authenticated.get('/api/automation-runs', async (c) => {
    const automationId = c.req.query('automationId')?.trim();
    const runs = await service.automationServiceInstance.listRuns({
      automationId: automationId || undefined,
      limit: parseLimit(c.req.query('limit'), 50),
    });
    return c.json({ runs });
  });

  authenticated.get('/api/automation-runs/product-events', async (c) => {
    const eventType = c.req.query('eventType')?.trim();
    if (!eventType) return c.json({ error: 'eventType is required' }, 400);
    const payloadKey = c.req.query('payloadKey')?.trim();
    const payloadValue = c.req.query('payloadValue')?.trim();
    const items = await service.automationServiceInstance.listRunsForProductEvent({
      eventType,
      source: c.req.query('source')?.trim() || undefined,
      payloadKey: payloadKey || undefined,
      payloadValue: payloadValue || undefined,
      limit: parseLimit(c.req.query('limit'), 10),
    });
    return c.json({ items });
  });

  authenticated.get('/api/automation-runs/:runId', async (c) => {
    const run = await service.automationServiceInstance.getRun(c.req.param('runId'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json({ run });
  });

  authenticated.get('/api/automation-runs/:runId/events', async (c) => {
    const runId = c.req.param('runId');
    const run = await service.automationServiceInstance.getRun(runId);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    const events = await service.automationServiceInstance.listRunEvents(runId);
    return c.json({ events });
  });

  authenticated.post('/api/automation-runs/:runId/rerun', async (c) => {
    try {
      const run = await service.automationServiceInstance.rerunFromRun(c.req.param('runId'));
      return c.json({ run }, 201);
    } catch (err) {
      if (err instanceof AutomationAlreadyRunningError) {
        return c.json({
          error: err.message,
          code: 'automation_already_running',
          automationId: err.automationId,
          runningRunId: err.runningRunId,
        }, 409);
      }
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'rerun' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to rerun automation' }, 400);
    }
  });

  authenticated.post('/api/automation-runs/:runId/repair-draft', async (c) => {
    const runId = c.req.param('runId');
    const run = await service.automationServiceInstance.getRun(runId);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    if (!['failed', 'timeout', 'cancelled'].includes(run.status)) {
      return c.json({ error: 'Repair draft is only available for failed, timed out, or cancelled runs' }, 400);
    }
    const automation = await service.automationServiceInstance.get(run.automationId);
    if (!automation) return c.json({ error: 'Automation not found' }, 404);
    const body = await c.req.json().catch(() => null) as { agentId?: unknown; language?: unknown } | null;
    const agentId = typeof body?.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : resolveDefaultAgentId(service.currentConfig);
    const events = await service.automationServiceInstance.listRunEvents(runId);
    const draftService = new AutomationDraftService({ config: service.currentConfig });
    try {
      const repair = await draftService.createRepairDraft({
        agentId,
        automation,
        run,
        events,
        language: body?.language === 'zh' ? 'zh' : 'en',
      }, c.req.raw.signal);
      return c.json({ repair }, 201);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.automations', { operation: 'repairDraft' });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create automation repair draft' }, 400);
    }
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
