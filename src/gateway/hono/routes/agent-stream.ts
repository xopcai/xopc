import type { Hono } from 'hono';

import {
  createAgentResumeHandler,
  createEventsSSEHandler,
  createSendHandler,
} from '../sse.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { validateWebchatAttachments } from '../../chat-limits.js';
import type { UserTurnAttachment } from '../../user-turn-input.js';

export function registerAgentStreamRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, chatRateLimitMiddleware, sseConfig } = deps;

  authenticated.post('/api/agent/resume', chatRateLimitMiddleware, createAgentResumeHandler(sseConfig));

  authenticated.post('/api/agent/abort', chatRateLimitMiddleware, async (c) => {
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
    const result = await service.abortAgentRun(runId);
    return c.json({ ok: true, payload: result });
  });

  authenticated.get('/api/sessions/:sessionKey/input-state', (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    if (!sessionKey) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sessionKey' } }, 400);
    return c.json({ ok: true, payload: service.getSessionInputState(sessionKey) });
  });

  authenticated.post('/api/sessions/:sessionKey/inputs', chatRateLimitMiddleware, async (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !sessionKey) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request' } }, 400);
    const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
    const attachmentError = validateWebchatAttachments(attachments);
    if (attachmentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: attachmentError } }, 400);
    const delivery = body.delivery === 'next' || body.delivery === 'steer' ? body.delivery : null;
    if (!delivery) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing delivery' } }, 400);
    const result = await service.submitSessionInput({
      sessionKey,
      clientMessageId: typeof body.clientMessageId === 'string' ? body.clientMessageId : '',
      delivery,
      content: typeof body.content === 'string' ? body.content : '',
      attachments: attachments as UserTurnAttachment[] | undefined,
      thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
    });
    if (result.ok === false) return c.json({ ok: false, error: { code: result.code, message: 'Input was not accepted' } }, result.code === 'QUEUE_FULL' ? 409 : 400);
    return c.json({ ok: true, payload: result }, 202);
  });

  authenticated.patch('/api/sessions/:sessionKey/inputs/:inputId', chatRateLimitMiddleware, async (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    const inputId = c.req.param('inputId')?.trim() ?? '';
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.version !== 'number') return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing version' } }, 400);
    const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
    const attachmentError = validateWebchatAttachments(attachments);
    if (attachmentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: attachmentError } }, 400);
    const result = await service.updateSessionInput(sessionKey, inputId, {
      version: body.version,
      content: typeof body.content === 'string' ? body.content : undefined,
      attachments: attachments as UserTurnAttachment[] | undefined,
      thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
      position: typeof body.position === 'number' ? body.position : undefined,
    });
    return result.ok ? c.json({ ok: true, payload: result.state }) : c.json({ ok: false, error: { code: 'CONFLICT', message: 'Input changed' }, payload: result.state }, 409);
  });

  authenticated.delete('/api/sessions/:sessionKey/inputs/:inputId', chatRateLimitMiddleware, (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    const inputId = c.req.param('inputId')?.trim() ?? '';
    const version = Number(c.req.query('version'));
    if (!Number.isFinite(version)) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing version' } }, 400);
    const result = service.removeSessionInput(sessionKey, inputId, version);
    return result.ok ? c.json({ ok: true, payload: result.state }) : c.json({ ok: false, error: { code: 'CONFLICT', message: 'Input changed' }, payload: result.state }, 409);
  });

  authenticated.post('/api/clarify/:requestId', chatRateLimitMiddleware, async (c) => {
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

  authenticated.post('/api/send', chatRateLimitMiddleware, createSendHandler(sseConfig));

  authenticated.get('/api/events', createEventsSSEHandler(sseConfig));
}
