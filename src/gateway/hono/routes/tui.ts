import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { collectTuiStartupResources } from '../../../tui/tui-startup-resources.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerTuiRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/tui/startup-resources', (c) => {
    const conversationId = c.req.query('conversationId')?.trim() || undefined;
    const payload = collectTuiStartupResources(deps.service.currentConfig as Config, conversationId);
    return c.json({ ok: true, payload });
  });
}
