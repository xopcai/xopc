import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { CapabilityCallSchema, ExtensionCapabilityBindingSchema, LocalAppPreviewCreateSchema } from '@xopcai/gateway-contract';

import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { CapabilityError } from '../../../capabilities/runtime/errors.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const Request = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('capability.describe'), params: z.strictObject({ id: ExtensionCapabilityBindingSchema.shape.id }) }),
  z.strictObject({ method: z.literal('capability.call'), params: z.strictObject({ id: ExtensionCapabilityBindingSchema.shape.id, call: CapabilityCallSchema }) }),
  z.strictObject({ method: z.enum(['storage.get', 'storage.remove']), params: z.strictObject({ key: z.string().max(512) }) }),
  z.strictObject({ method: z.literal('storage.set'), params: z.strictObject({ key: z.string().max(512), value: z.json() }) }),
  z.strictObject({ method: z.literal('storage.keys'), params: z.strictObject({}).optional() }),
]);

export function registerLocalAppPreviewRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const sessions = deps.service.localApps.previews;
  const dispatcher = createProductDispatcher(() => deps.service.notesServiceInstance, { getProjects: () => deps.service.projects });
  const error = (c: Parameters<typeof capabilityHttpError>[0], value: unknown) => capabilityHttpError(c,
    value instanceof z.ZodError ? new CapabilityError('INVALID_INPUT', 'Invalid preview request') : value);
  app.post('/api/local-app-previews/:appId/sessions', deps.strictRateLimitMiddleware, bodyLimit({ maxSize: 256_000 }), async c => {
    try {
      const input = LocalAppPreviewCreateSchema.parse(await c.req.json().catch(() => null));
      return c.json({ session: await sessions.create(c.req.param('appId'), input, capabilityHttpContext(c)) }, 201);
    } catch (cause) { return error(c, cause); }
  });
  app.get('/api/local-app-previews/sessions/:id', c => {
    try { return c.json(sessions.describe(c.req.param('id'), capabilityHttpContext(c), dispatcher)); }
    catch (cause) { return error(c, cause); }
  });
  app.delete('/api/local-app-previews/sessions/:id', c => {
    try { sessions.remove(c.req.param('id'), capabilityHttpContext(c)); return c.json({ ok: true }); }
    catch (cause) { return error(c, cause); }
  });
  app.post('/api/local-app-previews/sessions/:id/requests', deps.strictRateLimitMiddleware, bodyLimit({ maxSize: 2_100_000 }), async c => {
    try {
      const request = Request.parse(await c.req.json().catch(() => null));
      const caller = capabilityHttpContext(c); const id = c.req.param('id');
      if (request.method === 'capability.describe') {
        const descriptor = sessions.describe(id, caller, dispatcher).capabilities.find(item => item.id === request.params.id);
        if (!descriptor) throw new CapabilityError('FORBIDDEN', 'Capability unavailable in this preview');
        return c.json({ value: descriptor });
      }
      if (request.method === 'capability.call') return c.json({ value: await sessions.call(id, request.params.id, request.params.call, caller, dispatcher) });
      const params = request.params as { key?: string; value?: unknown } | undefined;
      return c.json({ value: sessions.storage(id, caller, request.method, params?.key, params?.value) ?? null });
    } catch (cause) { return error(c, cause); }
  });
}
