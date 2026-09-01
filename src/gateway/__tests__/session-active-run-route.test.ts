import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

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

describe('GET /api/session-runs', () => {
  it('returns the authoritative active-run snapshot', async () => {
    const runs = [{ sessionKey: 'agent:main:webchat:default:direct:abc', runId: 'run-123' }];
    const service = {
      isGatewayReady: () => true,
      sessions: { listActiveRuns: () => runs },
    } as unknown as GatewayService;
    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request('/api/session-runs');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, payload: { runs } });
  });
});

describe('POST /api/sessions/:key/fork-at-turn', () => {
  it('delegates using only the turn id and returns the server-generated session', async () => {
    const sourceKey = 'agent:main:webchat:default:direct:source';
    const forkedKey = 'agent:main:webchat:default:direct:server-generated';
    const forkAtTurn = vi.fn(async () => ({
      sessionKey: forkedKey,
      rowCount: 4,
      lastTurnId: 'turn-1',
      session: { key: forkedKey, messages: [] },
    }));
    const service = { sessions: { forkAtTurn } } as unknown as GatewayService;
    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request(`/api/sessions/${encodeURIComponent(sourceKey)}/fork-at-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastTurnId: 'turn-1', targetKey: 'client-must-not-control-this' }),
    });

    expect(res.status).toBe(201);
    expect(forkAtTurn).toHaveBeenCalledWith(sourceKey, 'turn-1');
    await expect(res.json()).resolves.toMatchObject({ ok: true, sessionKey: forkedKey });
  });

  it('rejects a missing turn id before touching the service', async () => {
    const forkAtTurn = vi.fn();
    const app = new Hono();
    registerSessionsRoutes(app, {
      service: { sessions: { forkAtTurn } } as unknown as GatewayService,
    });

    const res = await app.request('/api/sessions/source/fork-at-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(400);
    expect(forkAtTurn).not.toHaveBeenCalled();
  });
});

describe('GET /api/sessions/:key/history', () => {
  it('rejects non-numeric history cursors', async () => {
    let called = false;
    const service = {
      isGatewayReady: () => true,
      sessions: {
        getMessagePage: async () => {
          called = true;
          return null;
        },
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request('/api/sessions/test/history?before=cursor_3');
    expect(res.status).toBe(400);
    expect(called).toBe(false);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid session history cursor' });
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
