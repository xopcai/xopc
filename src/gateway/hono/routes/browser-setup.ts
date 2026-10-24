import type { Hono } from 'hono';
import { z } from 'zod';

import { getSessionMetadata } from '../../../storage/sqlite/session-read-repository.js';
import { readBrowserSetup } from '../../../browser/setup/repository.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { isLocalOwnerRequest } from './browser.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const requestSchema = z.strictObject({
  conversationId: z.string().uuid(),
  setupId: z.string().uuid().optional(),
  action: z.enum(['inspect', 'start', 'get', 'approve', 'prepare', 'recheck', 'open', 'begin_verification', 'cancel', 'release']),
  expectedRevision: z.number().int().positive().optional(),
  endpointId: z.string().min(1).max(500).optional(),
  open: z.enum(['chrome', 'folder', 'both']).optional(),
});

export function registerBrowserSetupRoutes(app: Hono, deps: AuthenticatedRouteDeps) {
  app.post('/api/browser/setup', deps.strictRateLimitMiddleware, async c => {
    if (!isLocalOwnerRequest(c, deps.service)) return c.json({ ok: false, error: 'LOCAL_OWNER_REQUIRED: Open setup on the Gateway computer. Remote pairing is available in Device access.' }, 403);
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid setup request' }, 400);
    const body = parsed.data;
    const metadata = getSessionMetadata(body.conversationId);
    if (!metadata) return c.json({ ok: false, error: 'Conversation not found' }, 404);
    const service = deps.service.browserSetup;
    const context = { conversationId: body.conversationId, agentId: metadata.agentId };
    try {
      if (body.action === 'inspect' || body.action === 'start') return c.json({ ok: true, payload: await service.command(body.action, {}, context) });
      if (!body.setupId) return c.json({ ok: false, error: 'setupId is required' }, 400);
      const setup = service.owned(body.setupId, context.conversationId, context.agentId);
      if (body.action === 'get' || body.action === 'recheck' || body.action === 'cancel') {
        return c.json({ ok: true, payload: await service.command(body.action, { setupId: setup.id }, context) });
      }
      const principalId = getGatewayPrincipal(c).principalId;
      if (body.action === 'approve') {
        if (!body.expectedRevision) throw new Error('expectedRevision is required');
        return c.json({ ok: true, payload: service.view(service.approve(setup, principalId, body.expectedRevision)) });
      }
      if (body.action === 'release') return c.json({ ok: true, payload: service.view(await service.release(setup)) });
      if (setup.approvedBy !== principalId) return c.json({ ok: false, error: 'Plan must be approved by this owner' }, 403);
      if (body.action === 'prepare') return c.json({ ok: true, payload: service.view(await service.prepare(setup)) });
      if (body.action === 'open') {
        await service.open(setup, body.open ?? 'both');
        return c.json({ ok: true, payload: service.view(readBrowserSetup(setup.id)!) });
      }
      if (body.action === 'begin_verification') {
        if (!body.endpointId || !body.expectedRevision) throw new Error('Select an endpoint and provide expectedRevision');
        return c.json({ ok: true, payload: service.view(service.begin(setup, body.endpointId, new URL(c.req.url).origin, body.expectedRevision)) });
      }
      return c.json({ ok: false, error: 'Unsupported action' }, 400);
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'Browser setup failed' }, 409); }
  });
}
