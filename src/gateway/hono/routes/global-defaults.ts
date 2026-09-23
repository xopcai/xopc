import type { Hono } from 'hono';

import { AgentDefaultsSchema } from '../../../agent-config/index.js';
import {
  listGlobalDefaults,
  updateGlobalDefaults,
  type UpdateGlobalDefaultsBody,
} from '../../global-defaults-admin.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function parsePatchBody(raw: unknown): UpdateGlobalDefaultsBody | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'body must be an object' };
  }
  const body = raw as Record<string, unknown>;
  const parsed = AgentDefaultsSchema.safeParse(body.defaults);
  return parsed.success
    ? { defaults: parsed.data }
    : { error: `defaults ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
}

function isParseError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: string }).error === 'string'
  );
}

export function registerGlobalDefaultsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/global-defaults', async (c) => {
    return c.json({ ok: true, payload: listGlobalDefaults() });
  });

  authenticated.patch('/api/global-defaults', strictRateLimitMiddleware, async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const body = parsePatchBody(raw);
    if (isParseError(body)) {
      return c.json({ ok: false, error: { message: body.error } }, 400);
    }
    const result = updateGlobalDefaults(body);
    if (result.ok === false) {
      return c.json({ ok: false, error: { message: result.error } }, result.status ?? 400);
    }
    if (result.data.changed) service.refreshAgentCatalog();
    return c.json({ ok: true, payload: listGlobalDefaults() });
  });
}
