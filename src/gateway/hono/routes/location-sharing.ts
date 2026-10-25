import { endpointTurnClaimSchema, locationShareRequestSchema } from '@xopcai/endpoint-tools-protocol';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { LocationSharingError } from '../../../endpoint-tools/location-sharing.js';
import { endpointClaimBelongsToPrincipal } from '../../../endpoint-tools/turn-context.js';
import { getPhoneRuntime } from '../../../phone/runtime.js';
import { PhoneError } from '../../../phone/contracts.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { hasGatewayScope } from '../../security/gateway-scopes.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const root = '/api/user-context/environment/location-shares';
const originBody = z.strictObject({ origin: endpointTurnClaimSchema });
export function registerLocationSharingRoutes(parent: Hono, deps: AuthenticatedRouteDeps) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof LocationSharingError || error instanceof PhoneError) return c.json({ ok: false,
      error: { code: error.code, message: error.message } }, 409);
    return c.json({ ok: false, error: { code: 'LOCATION_UNAVAILABLE', message: 'Location sharing is unavailable' } }, 503);
  });
  const runtime = deps.service.endpointTools;
  runtime.locations?.setConsumer({
    apply: (input, signal) => getPhoneRuntime().environment.apply(input, signal),
    clear: (id, phoneId) => getPhoneRuntime().environment.clear(id, phoneId),
    state: (id, phoneId) => {
      const state = getPhoneRuntime().environment.status(phoneId);
      return state.status === 'clean' || state.shareId !== id ? 'clean' : state.status === 'applied' ? 'applied' : state.status === 'pending' ? 'pending' : 'cleanup_pending';
    },
  });
  const authorize = (c: Context, origin: z.infer<typeof endpointTurnClaimSchema>) =>
    endpointClaimBelongsToPrincipal(runtime.registry, origin.endpointId, getGatewayPrincipal(c))
      && runtime.registry.verifyTurnClaim(origin.endpointId, origin.token);
  for (const path of [root, `${root}/*`]) app.use(path, bodyLimit({ maxSize: 4096,
    onError: c => c.json({ ok: false, error: { code: 'LOCATION_TOO_LARGE', message: 'Location request exceeds 4 KB' } }, 413) }), async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.post(root, async c => {
    const parsed = originBody.extend({ request: locationShareRequestSchema, disclosureVersion: z.literal('location-sharing-v1') }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'LOCATION_INVALID', message: 'Invalid location sharing request' } }, 400);
    if (!authorize(c, parsed.data.origin)) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Location source is not accessible' } }, 403);
    const actor = getGatewayPrincipal(c);
    if (!hasGatewayScope(actor.scopes, 'agents.run') || !await deps.service.sessions.getSession(parsed.data.request.conversationId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Conversation is not accessible' } }, 403);
    }
    if (parsed.data.request.phoneId) {
      if (!deps.service.currentConfig.phone.enabled) return c.json({ ok: false, error: { code: 'PHONE_DISABLED', message: 'Enable Phone Use before sharing location' } }, 409);
      const phone = getPhoneRuntime().repository.get(parsed.data.request.phoneId);
      if (!phone.enabled || phone.connection?.kind !== 'aliyun-adb') return c.json({ ok: false, error: { code: 'PHONE_ENV_UNSUPPORTED', message: 'Choose an enabled Alibaba cloud phone' } }, 409);
    }
    return c.json({ ok: true, payload: runtime.locations.create(parsed.data.origin.endpointId, parsed.data.request) }, 201);
  });
  app.get(root, c => {
    const endpointId = c.req.query('endpointId') ?? '';
    if (!endpointClaimBelongsToPrincipal(runtime.registry, endpointId, getGatewayPrincipal(c))) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Location source is not accessible' } }, 403);
    return c.json({ ok: true, payload: runtime.locations.list(endpointId, c.req.query('conversationId')) });
  });
  app.post(`${root}/:id/samples`, async c => {
    const parsed = originBody.extend({ sequence: z.number().int().positive(), sample: z.unknown() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'LOCATION_INVALID', message: 'Invalid location sample' } }, 400);
    if (!authorize(c, parsed.data.origin)) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Location source is not accessible' } }, 403);
    return c.json({ ok: true, payload: await runtime.locations.sample(c.req.param('id'), parsed.data.origin.endpointId,
      { sequence: parsed.data.sequence, sample: parsed.data.sample }) });
  });
  app.delete(`${root}/:id`, async c => {
    const parsed = originBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !authorize(c, parsed.data.origin)) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Location source is not accessible' } }, 403);
    return c.json({ ok: true, payload: await runtime.locations.revoke(c.req.param('id'), parsed.data.origin.endpointId) });
  });
  parent.route('/', app);
}
