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
