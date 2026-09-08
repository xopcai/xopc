import type { Hono } from 'hono';

import type { BrowserAutomationRun } from '../../../browser/automations/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function presentRun(run: BrowserAutomationRun) {
  return {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    inputs: run.inputs,
    result: run.result,
    error: run.error,
    createdAtMs: run.createdAtMs,
    startedAtMs: run.startedAtMs,
    endedAtMs: run.endedAtMs,
    durationMs: run.durationMs,
  };
}

function parseStatus(value: unknown): 'enabled' | 'disabled' | undefined {
  if (value === undefined) return undefined;
  if (value === 'enabled' || value === 'disabled') return value;
  throw new Error('status must be enabled or disabled.');
}

export function registerBrowserAutomationRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const service = deps.service.browserAutomations;
  authenticated.get('/api/browser/automations', (c) => c.json({ automations: service.list() }));
  authenticated.post('/api/browser/automations', deps.strictRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json();
      return c.json({ automation: service.save({ definition: body.definition, status: parseStatus(body.status) }) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  authenticated.get('/api/browser/automations/:id', (c) => {
    const automation = service.get(c.req.param('id'));
    return automation ? c.json({ automation }) : c.json({ error: 'Browser automation not found.' }, 404);
  });
  authenticated.patch('/api/browser/automations/:id', deps.strictRateLimitMiddleware, async (c) => {
    try {
      const current = service.get(c.req.param('id'));
      if (!current) return c.json({ error: 'Browser automation not found.' }, 404);
      const body = await c.req.json();
      return c.json({ automation: service.save({ definition: body.definition ?? current.definition, status: parseStatus(body.status) ?? current.status, expectedId: current.id }) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  authenticated.delete('/api/browser/automations/:id', deps.strictRateLimitMiddleware, (c) => {
    try { return c.json({ removed: service.remove(c.req.param('id')) }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  authenticated.post('/api/browser/automations/:id/run', deps.strictRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const inputs = body.inputs ?? {};
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return c.json({ error: 'inputs must be an object.' }, 400);
      return c.json({ run: presentRun(service.startRun(c.req.param('id'), inputs)) }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  authenticated.get('/api/browser/automation-runs', (c) => c.json({ runs: service.listRuns(c.req.query('automationId')).map(presentRun) }));
  authenticated.get('/api/browser/automation-runs/:id', (c) => {
    const run = service.getRun(c.req.param('id'));
    return run ? c.json({ run: presentRun(run) }) : c.json({ error: 'Run not found.' }, 404);
  });
  authenticated.post('/api/browser/automation-runs/:id/cancel', deps.strictRateLimitMiddleware, (c) => c.json({ cancelled: service.cancel(c.req.param('id')) }));
}
