import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import { registerSessionsRoutes } from '../sessions.js';

describe('session agent config route', () => {
  it('returns a structured 404 instead of throwing when a local draft is not materialized', async () => {
    const getFixedAgentConfig = vi.fn();
    const app = new Hono();
    registerSessionsRoutes(app, { service: {
      sessions: { getSession: vi.fn(async () => undefined), getFixedAgentConfig },
    } as unknown as GatewayService });

    const response = await app.request('/api/sessions/3d5c8525-8ad6-4d89-bbc6-e73651679b86/agent-config');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    expect(getFixedAgentConfig).not.toHaveBeenCalled();
  });
});

it('rejects permission changes from a device without owner authority', async () => {
  const patchAgentConfig = vi.fn();
  const app = new Hono();
  app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind: 'device', principalId: 'device-1', scopes: [] }); await next(); });
  registerSessionsRoutes(app, { service: { sessions: { patchAgentConfig } } as unknown as GatewayService });
  const response = await app.request('/api/sessions/3d5c8525-8ad6-4d89-bbc6-e73651679b86/agent-config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionApprovalMode: 'full', configVersion: 1 }),
  });
  expect(response.status).toBe(403);
  expect(patchAgentConfig).not.toHaveBeenCalled();
});
