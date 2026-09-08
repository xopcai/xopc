import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';
import { validateWebchatAttachments, validateWebchatContent } from '../../chat-limits.js';
import { parseTurnContextRefs } from '../../../agent/source-context/types.js';
import type { UserTurnAttachment } from '../../user-turn-input.js';
import { replaceLatestSessionTurn, submitSessionInput } from './session-input-handler.js';

export function registerAgentStreamRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, chatRateLimitMiddleware } = deps;

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
    return submitSessionInput(c, deps, sessionKey);
  });

  authenticated.post('/api/sessions/:sessionKey/turns/:turnId/replace', chatRateLimitMiddleware, async (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    const turnId = (c.req.param('turnId') ?? '').trim();
    return replaceLatestSessionTurn(c, deps, sessionKey, turnId);
  });

  authenticated.patch('/api/sessions/:sessionKey/inputs/:inputId', chatRateLimitMiddleware, async (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    const inputId = c.req.param('inputId')?.trim() ?? '';
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.version !== 'number') return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing version' } }, 400);
    const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
    const contextRefs = body.contextRefs === undefined
      ? undefined
      : parseTurnContextRefs(body.contextRefs);
    if (contextRefs === null) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid Note context references' } }, 400);
    if (body.content !== undefined) {
      const contentError = validateWebchatContent(body.content);
      if (contentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: contentError } }, 400);
    }
    const attachmentError = validateWebchatAttachments(attachments);
    if (attachmentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: attachmentError } }, 400);
    const result = await service.updateSessionInput(sessionKey, inputId, {
      version: body.version,
      content: typeof body.content === 'string' ? body.content : undefined,
      attachments: attachments as UserTurnAttachment[] | undefined,
      contextRefs,
      thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
      position: typeof body.position === 'number' ? body.position : undefined,
    });
    return result.ok
      ? c.json({ ok: true, payload: result.state })
      : c.json({
          ok: false,
          error: {
            code: result.contextUnavailable ? 'CONTEXT_UNAVAILABLE' : 'CONFLICT',
            message: result.contextUnavailable
              ? 'A referenced Note changed or is no longer available. Select it again.'
              : 'Input changed',
          },
          payload: result.state,
        }, 409);
  });

  authenticated.delete('/api/sessions/:sessionKey/inputs/:inputId', chatRateLimitMiddleware, (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    const inputId = c.req.param('inputId')?.trim() ?? '';
    const version = Number(c.req.query('version'));
    if (!Number.isFinite(version)) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing version' } }, 400);
    const result = service.removeSessionInput(sessionKey, inputId, version);
    return result.ok ? c.json({ ok: true, payload: result.state }) : c.json({ ok: false, error: { code: 'CONFLICT', message: 'Input changed' }, payload: result.state }, 409);
  });

  authenticated.get('/api/sessions/:sessionKey/clarification', (c) => {
    const sessionKey = (c.req.param('sessionKey') ?? '').trim();
    if (!sessionKey) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sessionKey' } }, 400);
    const snapshot = service.getClarificationState(sessionKey);
    if (!snapshot) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    return c.json({ ok: true, payload: snapshot });
  });

  authenticated.post('/api/clarifications/:id/responses', chatRateLimitMiddleware, async (c) => {
    const id = c.req.param('id')?.trim() ?? '';
    const body = await c.req.json().catch(() => null);
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const action = record.action;
    const expectedVersion = record.expectedVersion;
    const idempotencyKey = typeof record.idempotencyKey === 'string' ? record.idempotencyKey.trim() : '';
    if (!id || !idempotencyKey || typeof expectedVersion !== 'number'
      || !Number.isInteger(expectedVersion)
      || (action !== 'answer' && action !== 'agent_decide' && action !== 'cancel')) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid clarification response' } }, 400);
    }
    const result = service.resolveClarificationResponse({
      id,
      expectedVersion,
      idempotencyKey,
      action,
      answer: typeof record.answer === 'string' ? record.answer : undefined,
    });
    if (result.ok === true) return c.json({ ok: true, payload: result }, result.queued ? 202 : 200);
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'EXPIRED' ? 410 : result.code === 'INVALID' ? 400 : 409;
    const message = result.code === 'NOT_FOUND'
      ? 'This clarification is no longer active'
      : result.code === 'EXPIRED'
        ? 'This approval has expired'
        : result.code === 'INVALID'
          ? 'The clarification response is invalid'
          : 'The clarification changed; reload and try again';
    return c.json({ ok: false, error: { code: result.code, message }, payload: result.clarification }, status);
  });

  authenticated.post('/api/send', chatRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const channel = typeof body?.channel === 'string' ? body.channel : '';
    const chatId = typeof body?.chatId === 'string' ? body.chatId : '';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!channel || !chatId || !content) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Missing required fields: channel, chatId, content' },
      }, 400);
    }
    try {
      return c.json({ ok: true, payload: await service.sendMessage(channel, chatId, content) });
    } catch (error) {
      return c.json({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
      }, 500);
    }
  });
}
