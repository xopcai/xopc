import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { registerSessionsRoutes } from '../hono/routes/sessions.js';
import type { GatewayService } from '../service.js';
import { performSessionReset } from '../session-reset-service.js';
import type { SessionIndex } from '../../session/index.js';
import type { AgentService } from '../../agent/service.js';

vi.mock('../../agent/embedded/runs.js', () => ({
  abortEmbeddedRun: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../agent/mcp/bundle-mcp-tools.js', () => ({
  retireSessionMcpRuntimeForSessionKey: vi.fn().mockResolvedValue(undefined),
}));

describe('performSessionReset', () => {
  it('archives transcript, assigns new session id, and evicts agent runtime', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:abc';
    const resetSession = vi.fn().mockResolvedValue({
      sessionId: 'new-id',
      previousSessionId: 'old-id',
    });
    const evictSessionAgent = vi.fn();
    const sessionIndex = { resetSession } as unknown as SessionIndex;
    const getAgentService = () => ({ evictSessionAgent }) as unknown as AgentService;

    const result = await performSessionReset(sessionKey, { sessionIndex, getAgentService });

    expect(result).toEqual({
      ok: true,
      sessionId: 'new-id',
      previousSessionId: 'old-id',
    });
    expect(resetSession).toHaveBeenCalledWith(sessionKey);
    expect(evictSessionAgent).toHaveBeenCalledWith(sessionKey);
  });

  it('returns not found when session index has no entry', async () => {
    const sessionIndex = {
      resetSession: vi.fn().mockResolvedValue(null),
    } as unknown as SessionIndex;
    const getAgentService = () => ({ evictSessionAgent: vi.fn() }) as unknown as AgentService;

    const result = await performSessionReset('agent:main:webchat:default:direct:missing', {
      sessionIndex,
      getAgentService,
    });

    expect(result).toEqual({ ok: false, error: 'Session not found' });
  });

  it('rejects empty session key', async () => {
    const result = await performSessionReset('  ', {
      sessionIndex: { resetSession: vi.fn() } as unknown as SessionIndex,
      getAgentService: () => ({ evictSessionAgent: vi.fn() }) as unknown as AgentService,
    });
    expect(result).toEqual({ ok: false, error: 'Session key required' });
  });
});

describe('POST /api/sessions/:key/reset', () => {
  it('returns new session id and session payload', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:abc';
    const reset = vi.fn().mockResolvedValue({
      ok: true,
      sessionId: 'new-id',
      previousSessionId: 'old-id',
    });
    const service = {
      isGatewayReady: () => true,
      sessions: {
        reset,
        getSession: async (key: string) =>
          key === sessionKey ? { key, sessionId: 'new-id' } : null,
      },
    } as unknown as GatewayService;

    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const res = await app.request(`/api/sessions/${encodeURIComponent(sessionKey)}/reset`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reset: boolean;
      sessionId: string;
      previousSessionId: string;
      session: { key: string };
    };
    expect(body.ok).toBe(true);
    expect(body.reset).toBe(true);
    expect(body.sessionId).toBe('new-id');
    expect(body.previousSessionId).toBe('old-id');
    expect(body.session.key).toBe(sessionKey);
    expect(reset).toHaveBeenCalledWith(sessionKey);
  });
});
