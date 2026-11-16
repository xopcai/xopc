import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import { registerSessionsRoutes } from '../sessions.js';

describe('session agent config route', () => {
  it('returns the active transcript and config version from metadata without loading history', async () => {
    const conversationId = '3d5c8525-8ad6-4d89-bbc6-e73651679b86';
    const getSessionMetadata = vi.fn(async () => ({ transcriptId: 'transcript-current' }));
    const config = { model: 'test/model', thinkingLevel: 'off', configVersion: 17, fixedModel: true };
    const app = new Hono();
    registerSessionsRoutes(app, { service: {
      sessionIndexInstance: { getSessionMetadata },
      sessions: { getFixedAgentConfig: vi.fn(async () => config) },
    } as unknown as GatewayService });

    const response = await app.request(`/api/sessions/${conversationId}/agent-config`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, payload: { ...config, transcriptId: 'transcript-current' } });
    expect(getSessionMetadata).toHaveBeenCalledWith(conversationId);
  });

  it('returns a structured 404 instead of throwing when a local draft is not materialized', async () => {
    const getFixedAgentConfig = vi.fn();
    const app = new Hono();
    registerSessionsRoutes(app, { service: {
      sessionIndexInstance: { getSessionMetadata: vi.fn(async () => null) },
      sessions: { getFixedAgentConfig },
    } as unknown as GatewayService });

    const response = await app.request('/api/sessions/3d5c8525-8ad6-4d89-bbc6-e73651679b86/agent-config');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    expect(getFixedAgentConfig).not.toHaveBeenCalled();
  });
});
