import type { Hono } from 'hono';
import { CapabilityCallSchema } from '@xopcai/gateway-contract';

import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { CapabilityError } from '../../../capabilities/runtime/dispatcher.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerCapabilityOperationRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const dispatcher = createProductDispatcher(() => deps.service.notesServiceInstance, {
    getConfig: () => deps.service.currentConfig, getProjects: () => deps.service.projects,
    getAutomations: () => deps.service.automationServiceInstance,
    getWorkDiscovery: () => deps.service.workDiscovery,
    getLocalApps: () => deps.service.localApps,
    ...(deps.scenes ? { getSceneAccess: () => ({ services: deps.scenes!, principal: { ownerId: 'local-owner', workspaceId: deps.service.currentWorkspacePath } }) } : {}),
    wake: runId => runId ? deps.service.dispatchTaskRuns() : deps.service.dispatchTaskEvents(),
    abortConversation: async conversationId => {
      const liveRunId = deps.service.getActiveWebchatRunId(conversationId);
      if (liveRunId) await deps.service.abortAgentRun(liveRunId);
    },
  });
  app.get('/api/capabilities/operations', c => c.json({ capabilities: dispatcher.list(capabilityHttpContext(c)) }));
  app.get('/api/capabilities/operations/:id', c => {
    try { return c.json(dispatcher.describe(c.req.param('id'), capabilityHttpContext(c))); }
    catch (error) { return capabilityHttpError(c, error); }
  });
  app.post('/api/capabilities/operations/:id/invocations', deps.strictRateLimitMiddleware, async c => {
    try {
      const parsed = CapabilityCallSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new CapabilityError('INVALID_INPUT', 'Invalid capability request');
      const result = await dispatcher.call(c.req.param('id'), parsed.data.input, capabilityHttpContext(c), parsed.data);
      return c.json({ status: 'succeeded', data: result });
    } catch (error) { return capabilityHttpError(c, error); }
  });
}
