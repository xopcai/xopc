import { endpointTurnClaimSchema } from '@xopcai/endpoint-tools-protocol';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { EndpointContextError } from '../../../endpoint-tools/context-store.js';
import { endpointClaimBelongsToPrincipal } from '../../../endpoint-tools/turn-context.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const root = '/api/user-context/environment';
const mutationSchema = z.strictObject({ origin: endpointTurnClaimSchema, report: z.unknown().optional(), heartbeat: z.unknown().optional() });

export function registerEndpointEnvironmentRoutes(app: Hono, deps: AuthenticatedRouteDeps) {
  const runtime = deps.service.endpointTools;
  app.get(root, c => {
    const actor = getGatewayPrincipal(c);
    c.header('Cache-Control', 'no-store');
    const snapshots = runtime.registry.list()
      .filter(endpoint => endpointClaimBelongsToPrincipal(runtime.registry, endpoint.endpointId, actor))
      .map(endpoint => runtime.contexts.view(endpoint.endpointId)).filter(Boolean);
    return c.json({ ok: true, payload: snapshots });
  });
  app.get(`${root}/endpoints/:endpointId`, c => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('endpointId');
    if (!endpointClaimBelongsToPrincipal(runtime.registry, id, getGatewayPrincipal(c))) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Context source is not accessible' } }, 403);
    }
    try { return c.json({ ok: true, payload: { ...runtime.contexts.connection(id), context: runtime.contexts.view(id) } }); }
    catch { return c.json({ ok: false, error: { code: 'SOURCE_UNAVAILABLE', message: 'Context source is unavailable' } }, 409); }
  });
  for (const action of ['reports', 'heartbeats'] as const) {
    app.post(`${root}/${action}`, bodyLimit({ maxSize: 16_384 }), async c => {
      c.header('Cache-Control', 'no-store');
      const parsed = mutationSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || (action === 'reports' ? parsed.data.heartbeat !== undefined || parsed.data.report === undefined
        : parsed.data.report !== undefined || parsed.data.heartbeat === undefined)) {
        return c.json({ ok: false, error: { code: 'CONTEXT_INVALID', message: 'Invalid context request' } }, 400);
      }
      const { origin } = parsed.data;
      if (!endpointClaimBelongsToPrincipal(runtime.registry, origin.endpointId, getGatewayPrincipal(c))) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Context source is not accessible' } }, 403);
      }
      if (!runtime.registry.verifyTurnClaim(origin.endpointId, origin.token)) {
        return c.json({ ok: false, error: { code: 'SOURCE_UNAVAILABLE', message: 'Context connection changed' } }, 409);
      }
      try {
        const payload = action === 'reports' ? runtime.contexts.report(origin.endpointId, parsed.data.report)
          : runtime.contexts.heartbeat(origin.endpointId, parsed.data.heartbeat);
        return c.json({ ok: true, payload });
      } catch (error) {
        if (!(error instanceof EndpointContextError)) throw error;
        return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.code === 'CONTEXT_INVALID' ? 400 : 409);
      }
    });
  }
}
