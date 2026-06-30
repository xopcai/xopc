import type { Hono } from 'hono';

import { CapabilityPresetSchema } from '../../../agent-manifest/schema.js';
import type { Config } from '../../../config/schema.js';
import {
  listGlobalDefaults,
  prepareUpdateGlobalDefaults,
  type UpdateGlobalDefaultsBody,
} from '../../global-defaults-admin.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function parsePatchBody(raw: unknown): UpdateGlobalDefaultsBody | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'body must be an object' };
  }
  const body = raw as Record<string, unknown>;
  const out: UpdateGlobalDefaultsBody = {};
  if (Object.hasOwn(body, 'models')) {
    const parsed = CapabilityPresetSchema.pick({ models: true }).safeParse({ models: body.models });
    if (!parsed.success) {
      return { error: `models ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
    }
    out.models = parsed.data.models;
  }
  return out;
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
    return c.json({ ok: true, payload: await listGlobalDefaults(service.currentConfig as Config) });
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
    const prep = prepareUpdateGlobalDefaults(service.currentConfig as Config, body);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    return c.json({ ok: true, payload: await listGlobalDefaults(service.currentConfig as Config) });
  });
}
