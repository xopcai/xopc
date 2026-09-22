import { z } from 'zod';
import type { Hono } from 'hono';
import { CapabilityCallSchema } from '@xopcai/gateway-contract';

import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { CapabilityError } from '../../../capabilities/runtime/errors.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { localAppCapabilities } from '../../../local-apps/capabilities/runtime.js';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Invocation = z.strictObject({ manifestDigest: Digest, call: CapabilityCallSchema });

/** Authenticated host API. Iframes must not receive Gateway credentials. */
export function registerLocalAppCapabilityRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const dispatcher = createProductDispatcher(() => deps.service.notesServiceInstance, { getProjects: () => deps.service.projects });
  const path = '/api/local-app-capabilities/:extensionId';
  app.get(path, c => {
    try {
      const digest = Digest.parse(c.req.query('manifestDigest'));
      return c.json(localAppCapabilities(deps.service.localApps, dispatcher, c.req.param('extensionId'), digest, capabilityHttpContext(c)).list());
    } catch (error) { return capabilityHttpError(c, error instanceof z.ZodError ? new CapabilityError('INVALID_INPUT', 'Invalid manifest digest') : error); }
  });
  app.post(`${path}/:id/invocations`, deps.strictRateLimitMiddleware, async c => {
    try {
      const parsed = Invocation.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new CapabilityError('INVALID_INPUT', 'Invalid local app invocation');
      const { manifestDigest, call } = parsed.data;
      const extensionId = c.req.param('extensionId');
      const id = c.req.param('id');
      return c.json(await localAppCapabilities(deps.service.localApps, dispatcher, extensionId, manifestDigest, capabilityHttpContext(c)).call(id, call));
    } catch (error) { return capabilityHttpError(c, error); }
  });
}
