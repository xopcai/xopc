import { z } from 'zod';
import type { Hono } from 'hono';
import { CapabilityCallSchema } from '@xopcai/gateway-contract';
import { bodyLimit } from 'hono/body-limit';

import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { CapabilityError } from '../../../capabilities/runtime/errors.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { localAppCapabilities } from '../../../local-apps/capabilities/runtime.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { localAppDelegationCaller } from '../../security/local-app-delegation-access.js';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Invocation = z.strictObject({ manifestDigest: Digest, grantRevision: z.uuid(), call: CapabilityCallSchema });

/** Authenticated host API. Iframes must not receive Gateway credentials. */
export function registerLocalAppCapabilityRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const dispatcher = createProductDispatcher(() => deps.service.notesServiceInstance, { getProjects: () => deps.service.projects });
  const path = '/api/local-app-capabilities/:extensionId';
  app.get('/api/local-app-capabilities/catalog', c => c.json({ capabilities: dispatcher.list({ ...capabilityHttpContext(c), surface: 'extension' }) }));
  app.get(path, c => {
    try {
      const digest = Digest.parse(c.req.query('manifestDigest'));
      const grantRevision = z.uuid().parse(c.req.query('grantRevision'));
      return c.json(localAppCapabilities(deps.service.localApps, dispatcher, c.req.param('extensionId'), digest, capabilityHttpContext(c), grantRevision).list());
    } catch (error) { return capabilityHttpError(c, error instanceof z.ZodError ? new CapabilityError('INVALID_INPUT', 'Invalid manifest digest') : error); }
  });
  app.post(`${path}/:id/invocations`, deps.strictRateLimitMiddleware, bodyLimit({ maxSize: 2_100_000 }), async c => {
    try {
      const parsed = Invocation.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new CapabilityError('INVALID_INPUT', 'Invalid local app invocation');
      const { manifestDigest, grantRevision, call } = parsed.data;
      const extensionId = c.req.param('extensionId');
      const id = c.req.param('id');
      const caller = capabilityHttpContext(c);
      const guarded = id === 'xopc.agent.delegate' ? localAppDelegationCaller(caller, getGatewayPrincipal(c), () => deps.service.getResolvedAuth()) : caller;
      return c.json(await localAppCapabilities(deps.service.localApps, dispatcher, extensionId, manifestDigest, guarded, grantRevision).call(id, call));
    } catch (error) { return capabilityHttpError(c, error); }
  });
}
