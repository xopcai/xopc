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

describe('GET /api/runtime/quit-impact', () => {
  it('returns the gateway shutdown impact snapshot', async () => {
    const payload = { shouldConfirm: true, blockingCount: 1, blockingRuns: [], backgroundCount: 0, assessedAt: 1 };
    const service = {
      isGatewayReady: () => true,
      sessions: { getQuitImpact: async () => payload },
    } as unknown as GatewayService;
    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request('/api/runtime/quit-impact');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, payload });
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

describe('GET /api/sessions/:key/find', () => {
  it('returns ordered conversation matches', async () => {
    const findMessages = vi.fn(async () => ({
      query: '8318',
      total: 2,
      truncated: false,
      matches: [
        { displayIndex: 1, occurrence: 0 },
        { displayIndex: 4, occurrence: 0 },
      ],
    }));
    const service = {
      isGatewayReady: () => true,
      sessions: { findMessages },
    } as unknown as GatewayService;
    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request('/api/sessions/conversation-1/find?q=8318');

    expect(res.status).toBe(200);
    expect(findMessages).toHaveBeenCalledWith('conversation-1', '8318', 1_000);
    await expect(res.json()).resolves.toMatchObject({ ok: true, total: 2 });
  });

  it('rejects empty and oversized queries before searching', async () => {
    const findMessages = vi.fn();
    const service = {
      isGatewayReady: () => true,
      sessions: { findMessages },
    } as unknown as GatewayService;
    const app = new Hono();
    registerSessionsRoutes(app, { service });

    expect((await app.request('/api/sessions/conversation-1/find?q=')).status).toBe(400);
    expect((await app.request(`/api/sessions/conversation-1/find?q=${'x'.repeat(257)}`)).status).toBe(400);
    expect(findMessages).not.toHaveBeenCalled();
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
