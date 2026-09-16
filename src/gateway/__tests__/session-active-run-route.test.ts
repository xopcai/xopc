import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { registerSessionsRoutes } from '../hono/routes/sessions.js';
import type { GatewayService } from '../service.js';

describe('GET /api/sessions/:key/run', () => {
  it('returns active run from gateway service', async () => {
    const conversationId = "17305fb5-e9c2-4028-8aa3-1b2b6b86fedc";
    const service = {
      isGatewayReady: () => true,
      sessions: {
        getSession: async (key: string) => (key === conversationId ? { key } : null),
        getActiveRun: (key: string) =>
          key === conversationId ? { active: true, runId: 'run-123' } : { active: false },
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request(`/api/sessions/${encodeURIComponent(conversationId)}/run`);
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
    const runs = [{ conversationId: "17305fb5-e9c2-4028-8aa3-1b2b6b86fedc", runId: 'run-123' }];
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
    const sourceKey = "186828a5-4b36-42e0-85cc-6cd0114bd4c7";
    const forkedKey = "a4c30700-493a-443f-8754-c4b2ee89c70b";
    const forkAtTurn = vi.fn(async () => ({
      conversationId: forkedKey,
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
    await expect(res.json()).resolves.toMatchObject({ ok: true, conversationId: forkedKey });
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
  it('resolves transcriptId to canonical session key', async () => {
    const conversationId = "17305fb5-e9c2-4028-8aa3-1b2b6b86fedc";
    const transcriptId = 'session-123';
    const service = {
      sessions: {
        resolveSession: async (input: { transcriptId?: string }) =>
          input.transcriptId === transcriptId
            ? { conversationId, transcriptId, session: { key: conversationId, transcriptId } }
            : null,
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request(`/api/sessions/resolve?transcriptId=${encodeURIComponent(transcriptId)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      payload: { conversationId: string; transcriptId: string };
    };
    expect(body).toEqual({ ok: true, payload: { conversationId, transcriptId, session: { key: conversationId, transcriptId } } });
  });
});
