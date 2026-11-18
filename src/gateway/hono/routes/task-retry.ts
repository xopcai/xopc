import { TaskRetryRequestSchema } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { hasGatewayScope } from '../../security/gateway-scopes.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerTaskRetryRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.post('/api/tasks/:id/retry', deps.taskRateLimitMiddleware ?? deps.strictRateLimitMiddleware, async c => {
    if (!hasGatewayScope(getGatewayPrincipal(c).scopes, 'tasks.write')) return c.json({ error: 'Forbidden' }, 403);
    const parsed = TaskRetryRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid task retry request' }, 400);
    const result = await deps.service.retryTask({ taskId: c.req.param('id'), ...parsed.data });
    return c.json(result, result.status === 'not_found' ? 404 : 200);
  });
}
