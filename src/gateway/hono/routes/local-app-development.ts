import type { Hono } from 'hono';

import { capabilityHttpError } from '../../../capabilities/adapters/http.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerLocalAppDevelopmentRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.post('/api/local-apps/:id/development-conversation', c => {
    try { return c.json({ conversationId: deps.service.localApps.resolveDevelopmentConversation(c.req.param('id')) }); }
    catch (error) { return capabilityHttpError(c, error); }
  });
}
