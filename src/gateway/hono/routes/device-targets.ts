import { endpointTaskTargetRequestSchema } from '@xopcai/endpoint-tools-protocol';
import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';
import { z } from 'zod';

import { deviceExecutionPrincipalId } from '../../../endpoint-tools/execution-actor.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';

import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerDeviceTargetRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.use('/api/endpoint-tools/targets/:conversationId', async (c, next) => {
    const id = c.req.param('conversationId');
    if (!z.uuid().safeParse(id).success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    if (!getSessionMetadata(id)) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/api/endpoint-tools/targets/:conversationId', (c) => {
    try {
      const target = deps.service.endpointTools.targets.get(c.req.param('conversationId'));
      const actor = getGatewayPrincipal(c);
      if (target && actor.kind === 'device' && target.actorPrincipalId !== actor.principalId) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      }
      return target
        ? c.json({ ok: true, payload: target })
        : c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint target not found' } }, 404);
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid session key' } }, 400);
    }
  });

  app.put('/api/endpoint-tools/targets/:conversationId', bodyLimit({ maxSize: 4096 }), async (c) => {
    const parsed = endpointTaskTargetRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint target' } }, 400);
    }
    const gatewayPrincipal = getGatewayPrincipal(c);
    const endpoint = deps.service.endpointTools.registry.get(parsed.data.endpointId);
    if (gatewayPrincipal.kind === 'device'
      && (!endpoint || !gatewayPrincipal.deviceId || endpoint.principalId !== gatewayPrincipal.deviceId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Endpoint does not belong to this device' } }, 403);
    }
    try {
      const target = deps.service.endpointTools.targets.select(
        c.req.param('conversationId'),
        parsed.data.endpointId,
        Date.now(),
        deviceExecutionPrincipalId(gatewayPrincipal),
      );
      return c.json({ ok: true, payload: target });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'TARGET_OFFLINE' || message.startsWith('TARGET_RESOURCE_BUSY') ? 409 : 400;
      return c.json({ ok: false, error: { code: 'TARGET_SELECTION_FAILED', message } }, status);
    }
  });

  app.delete('/api/endpoint-tools/targets/:conversationId', (c) => {
    try {
      const target = deps.service.endpointTools.targets.get(c.req.param('conversationId')), actor = getGatewayPrincipal(c);
      if (target && actor.kind === 'device' && target.actorPrincipalId !== actor.principalId) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      const removed = deps.service.endpointTools.targets.clear(c.req.param('conversationId'));
      return c.json({ ok: true, payload: { removed } });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('TARGET_RESOURCE_BUSY')) return c.json({ ok: false, error: { code: 'TARGET_RESOURCE_BUSY' } }, 409);
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid conversation identity' } }, 400);
    }
  });

}
