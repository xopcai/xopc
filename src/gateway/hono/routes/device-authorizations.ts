import type { Hono } from 'hono';
import { z } from 'zod';
import { locationRequestSchema } from '@xopcai/endpoint-tools-protocol';

import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const authorizationSchema = z.object({ conversationId: z.uuid(), requestorPrincipalId: z.string().min(1).max(160),
  targetEndpointId: z.string().min(1).max(160), toolName: z.enum(['mobile.device.get_location', 'web.device.get_location', 'desktop.device.get_location']),
  arguments: locationRequestSchema,
}).strict();
export function registerDeviceAuthorizationRoutes(app: Hono, deps: AuthenticatedRouteDeps) {
  app.use('/api/endpoint-tools/target-authorizations*', async (c, next) => {
    if (getGatewayPrincipal(c).kind !== 'owner') return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Device authorization requires Gateway owner consent' } }, 403);
    c.header('Cache-Control', 'no-store'); await next();
  });
  app.get('/api/endpoint-tools/target-authorizations', c => c.json({ ok: true, payload: deps.service.endpointTools.grants.list() }));
  app.post('/api/endpoint-tools/target-authorizations', async c => {
    const parsed = authorizationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid single-call device authorization' } }, 400);
    if (!getSessionMetadata(parsed.data.conversationId)) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, 404);
    try { return c.json({ ok: true, payload: deps.service.endpointTools.grants.issue(parsed.data) }, 201); }
    catch { return c.json({ ok: false, error: { code: 'TARGET_UNAVAILABLE', message: 'Device or capability is unavailable' } }, 409); }
  });
  app.delete('/api/endpoint-tools/target-authorizations/:grantId', c => c.json({ ok: true,
    payload: { revoked: deps.service.endpointTools.grants.revoke(c.req.param('grantId')) } }));
}
