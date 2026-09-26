import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { AutomationCancelOutputSchema, AutomationReadOutputSchema, AutomationReadAllOutputSchema, AutomationDeleteOutputSchema, AutomationMutationOutputSchema, AutomationRunMutationOutputSchema, ProductReadContracts } from '@xopcai/gateway-contract';
import { CapabilityError } from '../../capabilities/runtime/dispatcher.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { capabilityHttpContext, capabilityHttpError } from '../../capabilities/adapters/http.js';

import type { AuthenticatedRouteDeps } from '../../gateway/hono/routes/deps.js';

function parseProjectId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export function registerAutomationRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const capabilities = createProductDispatcher(undefined, { getAutomations: () => service.automationServiceInstance, getProjects: () => service.projects, getConfig: () => service.currentConfig });
  const queueRun = async (c: Context, command: 'run' | 'rerun', id: string) => {
    try {
      const caller = capabilityHttpContext(c);
      const operation = `xopc.automations.${command}`;
      const { run } = AutomationRunMutationOutputSchema.parse(await capabilities.call(operation, { id }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() }));
      return c.json({ run }, command === 'rerun' ? 201 : 200);
    } catch (error) { return capabilityHttpError(c, error); }
  };

  authenticated.get('/api/automations', async (c) => {
    try {
      const { items } = ProductReadContracts['xopc.automations.list'].output.parse(await capabilities.call('xopc.automations.list',
        { projectId: parseProjectId(c.req.query('projectId')) }, capabilityHttpContext(c)));
      return c.json({ automations: items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automations', async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.create';
      const { automation } = AutomationMutationOutputSchema.parse(await capabilities.call(operation, body, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() }));
      return c.json({ automation }, 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automations/metrics', async (c) => {
    try {
      const { metrics } = ProductReadContracts['xopc.automations.metrics'].output.parse(await capabilities.call('xopc.automations.metrics', {}, capabilityHttpContext(c)));
      return c.json(metrics);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automations/draft', async (c) => {
    try {
      const input = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.draft';
      return c.json(await capabilities.call(operation, input, caller, {
        ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID(),
      }), 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automations/simulate', async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      return c.json(await capabilities.call('xopc.automations.simulate', body, capabilityHttpContext(c)));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automation-runs', async (c) => {
    const automationId = c.req.query('automationId')?.trim();
    const projectId = parseProjectId(c.req.query('projectId'));
    try {
      const { items } = ProductReadContracts['xopc.automations.history'].output.parse(await capabilities.call('xopc.automations.history', {
        automationId: automationId || undefined, projectId: automationId ? undefined : projectId,
        limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
      }, capabilityHttpContext(c)));
      return c.json({ runs: items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automation-events', async (c) => {
    try {
      const { items } = ProductReadContracts['xopc.automations.events'].output.parse(await capabilities.call('xopc.automations.events', {
        type: c.req.query('type'), source: c.req.query('source'),
        limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
      }, capabilityHttpContext(c)));
      return c.json({ items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automation-deliveries', async (c) => {
    try {
      const { items } = ProductReadContracts['xopc.automations.deliveries'].output.parse(await capabilities.call('xopc.automations.deliveries', {
        runId: c.req.query('runId'), status: c.req.query('status'),
        limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
      }, capabilityHttpContext(c)));
      return c.json({ items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automation-runs/product-events', async (c) => {
    try {
      const { items } = ProductReadContracts['xopc.automations.product_events'].output.parse(await capabilities.call('xopc.automations.product_events', {
        eventType: c.req.query('eventType'), source: c.req.query('source'),
        payloadKey: c.req.query('payloadKey'), payloadValue: c.req.query('payloadValue'),
        limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
      }, capabilityHttpContext(c)));
      return c.json({ items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automation-runs/:runId', async (c) => {
    try {
      const { run } = ProductReadContracts['xopc.automations.get_run'].output.parse(await capabilities.call('xopc.automations.get_run', { id: c.req.param('runId') }, capabilityHttpContext(c)));
      return c.json({ run });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automation-runs/:runId/events', async (c) => {
    try {
      const { events } = ProductReadContracts['xopc.automations.run_events'].output.parse(await capabilities.call('xopc.automations.run_events', { id: c.req.param('runId') }, capabilityHttpContext(c)));
      return c.json({ events });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automation-runs/:runId/read', async (c) => {
    try {
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.read';
      const { marked } = AutomationReadOutputSchema.parse(await capabilities.call(operation, { id: c.req.param('runId') }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() }));
      return c.json({ marked });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automation-runs/read-all', async (c) => {
    try {
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.read_all';
      const { count } = AutomationReadAllOutputSchema.parse(await capabilities.call(operation, { projectId: parseProjectId(c.req.query('projectId')) }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() }));
      return c.json({ count });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automation-runs/:runId/rerun', async (c) => {
    return queueRun(c, 'rerun', c.req.param('runId'));
  });

  authenticated.post('/api/automation-runs/:runId/repair-draft', async (c) => {
    try {
      const text = await c.req.text();
      let body: unknown;
      try { body = text ? JSON.parse(text) : {}; } catch { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected a request object');
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.repair_draft';
      return c.json(await capabilities.call(operation, { ...body, id: c.req.param('runId') }, caller, {
        ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID(),
      }), 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automation-runs/:runId/cancel', async (c) => {
    try {
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.cancel';
      const { cancelled, confirmed } = AutomationCancelOutputSchema.parse(await capabilities.call(operation, { id: c.req.param('runId') }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() }));
      return c.json({ cancelled, confirmed });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/automations/:id', async (c) => {
    try {
      const { automation } = ProductReadContracts['xopc.automations.get'].output.parse(await capabilities.call('xopc.automations.get',
        { id: c.req.param('id') }, capabilityHttpContext(c)));
      return c.json({ automation });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.patch('/api/automations/:id', async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected a patch object');
      const { expectedRevision: suppliedRevision, ...patch } = body;
      const key = c.req.header('idempotency-key');
      if (key !== undefined && suppliedRevision === undefined) {
        throw new CapabilityError('INVALID_INPUT', 'Idempotent automation changes require expectedRevision from the original read');
      }
      const id = c.req.param('id');
      const expectedRevision = suppliedRevision !== undefined ? suppliedRevision : (await service.automationServiceInstance.get(id))?.updatedAtMs;
      if (expectedRevision === undefined) throw new CapabilityError('NOT_FOUND', 'Automation not found');
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.update';
      const { automation } = AutomationMutationOutputSchema.parse(await capabilities.call(operation, { id, expectedRevision, patch }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: key ?? randomUUID() }));
      return c.json({ automation });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.delete('/api/automations/:id', async (c) => {
    try {
      const text = await c.req.text();
      let body: unknown = {};
      try { body = text ? JSON.parse(text) : {}; }
      catch { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'expectedRevision')) {
        throw new CapabilityError('INVALID_INPUT', 'Only expectedRevision is accepted');
      }
      const suppliedRevision = (body as { expectedRevision?: unknown }).expectedRevision;
      const key = c.req.header('idempotency-key');
      if (key !== undefined && suppliedRevision === undefined) throw new CapabilityError('INVALID_INPUT', 'Idempotent deletion requires the original expectedRevision');
      const id = c.req.param('id');
      const expectedRevision = suppliedRevision !== undefined ? suppliedRevision : (await service.automationServiceInstance.get(id))?.updatedAtMs ?? null;
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.automations.delete';
      const { removed } = AutomationDeleteOutputSchema.parse(await capabilities.call(operation, { id, expectedRevision }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: key ?? randomUUID() }));
      return c.json({ removed });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/automations/:id/run', async (c) => {
    return queueRun(c, 'run', c.req.param('id'));
  });

  for (const command of ['pause', 'resume'] as const) {
    authenticated.post(`/api/automations/:id/${command}`, async (c) => {
      try {
        const text = await c.req.text();
        let body: unknown = {};
        try { body = text ? JSON.parse(text) : {}; }
        catch { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => key !== 'expectedRevision')) {
          throw new CapabilityError('INVALID_INPUT', 'Only expectedRevision is accepted');
        }
        const suppliedRevision = (body as { expectedRevision?: unknown }).expectedRevision;
        const key = c.req.header('idempotency-key');
        if (key !== undefined && suppliedRevision === undefined) {
          throw new CapabilityError('INVALID_INPUT', 'Idempotent automation changes require expectedRevision from the original read');
        }
        const id = c.req.param('id');
        const expectedRevision = suppliedRevision !== undefined ? suppliedRevision : (await service.automationServiceInstance.get(id))?.updatedAtMs;
        if (expectedRevision === undefined) throw new CapabilityError('NOT_FOUND', 'Automation not found');
        const caller = capabilityHttpContext(c);
        const operation = 'xopc.automations.set_enabled';
        const { automation } = AutomationMutationOutputSchema.parse(await capabilities.call(operation,
          { id, enabled: command === 'resume', expectedRevision }, caller,
          { ...capabilities.describe(operation, caller), idempotencyKey: key ?? randomUUID() }));
        return c.json({ automation });
      } catch (error) { return capabilityHttpError(c, error); }
    });
  }
}
