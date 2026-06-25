import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerSessionsRoutes } from '../hono/routes/sessions.js';
import type { GatewayService } from '../service.js';

describe('GET /api/sessions/:key/run', () => {
  it('returns active run from gateway service', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:abc';
    const service = {
      isGatewayReady: () => true,
      sessions: {
        getSession: async (key: string) => (key === sessionKey ? { key } : null),
        getActiveRun: (key: string) =>
          key === sessionKey ? { active: true, runId: 'run-123' } : { active: false },
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request(`/api/sessions/${encodeURIComponent(sessionKey)}/run`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; payload: { active: boolean; runId?: string } };
    expect(body.ok).toBe(true);
    expect(body.payload).toEqual({ active: true, runId: 'run-123' });
  });

  it('returns 404 when session missing', async () => {
    const service = {
      isGatewayReady: () => true,
      sessions: {
        getSession: async () => null,
        getActiveRun: () => ({ active: false }),
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request('/api/sessions/missing:webchat:default:direct:x/run');
    expect(res.status).toBe(404);
  });
});

describe('/api/sessions/resolve', () => {
  it('resolves sessionId to canonical session key', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:abc';
    const sessionId = 'session-123';
    const service = {
      sessions: {
        resolveSession: async (input: { sessionId?: string }) =>
          input.sessionId === sessionId
            ? { sessionKey, sessionId, session: { key: sessionKey, sessionId } }
            : null,
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request(`/api/sessions/resolve?sessionId=${encodeURIComponent(sessionId)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      payload: { sessionKey: string; sessionId: string };
    };
    expect(body).toEqual({ ok: true, payload: { sessionKey, sessionId, session: { key: sessionKey, sessionId } } });
  });
});
