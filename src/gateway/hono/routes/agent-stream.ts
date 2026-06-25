import type { Hono } from 'hono';

import {
  createAgentResumeHandler,
  createAgentSSEHandler,
  createEventsSSEHandler,
  createSendHandler,
} from '../sse.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { createGatewayRouteLogger, logRouteWarn } from '../lib/route-logger.js';

const log = createGatewayRouteLogger('AgentStream');

export function registerAgentStreamRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware, sseConfig } = deps;

  authenticated.post('/api/agent', strictRateLimitMiddleware, createAgentSSEHandler(sseConfig));

  authenticated.post('/api/agent/resume', strictRateLimitMiddleware, createAgentResumeHandler(sseConfig));

  authenticated.post('/api/agent/abort', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    const runId =
      body && typeof body === 'object' && typeof (body as { runId?: unknown }).runId === 'string'
        ? (body as { runId: string }).runId.trim()
        : '';
    if (!runId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing runId' } },
        400,
      );
    }
    const aborted = service.abortAgentRun(runId);
    return c.json({ ok: true, payload: { aborted } });
  });

  authenticated.post('/api/agent/steer', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        400,
      );
    }
    const sessionKey =
      typeof (body as { sessionKey?: unknown }).sessionKey === 'string'
        ? (body as { sessionKey: string }).sessionKey.trim()
        : '';
    const message =
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : '';
    if (!sessionKey) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sessionKey' } },
        400,
      );
    }
    const result = await service.steerWebchatAgent(sessionKey, message);
    if (result.ok === false) {
      logRouteWarn(log, c, `Agent steer failed: ${result.code}`, 'gateway.route.agent', { sessionKey, code: result.code });
      const code = result.code;
      const status = code === 'BAD_REQUEST' ? 400 : code === 'NO_ACTIVE_RUN' ? 409 : 500;
      const msg =
        code === 'NO_ACTIVE_RUN'
              ? 'No active agent run for this session'
          : code === 'STEER_FAILED'
            ? 'Steer failed'
            : 'Message required';
      return c.json({ ok: false, error: { code, message: msg } }, status);
    }
    return c.json({ ok: true, payload: { steered: true } });
  });

  authenticated.post('/api/clarify/:requestId', strictRateLimitMiddleware, async (c) => {
    const requestId = c.req.param('requestId')?.trim() ?? '';
    if (!requestId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing requestId' } },
        400,
      );
    }
    const body = await c.req.json().catch(() => null);
    const skip =
      body &&
      typeof body === 'object' &&
      (body as { skip?: unknown }).skip === true;
    const rawAnswer =
      body && typeof body === 'object' && typeof (body as { answer?: unknown }).answer === 'string'
        ? (body as { answer: string }).answer
        : '';
    const answer = typeof rawAnswer === 'string' ? rawAnswer.trim() : '';
    if (!skip && !answer) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing answer field' } },
        400,
      );
    }
    const handled = service.submitClarifyResponse(requestId, skip ? '' : answer);
    if (!handled) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No pending clarification with this ID' } },
        404,
      );
    }
    return c.json({ ok: true, payload: { received: true } });
  });

  authenticated.post('/api/send', strictRateLimitMiddleware, createSendHandler(sseConfig));

  authenticated.get('/api/events', createEventsSSEHandler(sseConfig));
}
