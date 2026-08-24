import type { Context, Hono } from 'hono';

import {
  SideChatError,
  parseThinkingLevel,
  validateSideChatSelections,
} from '../../side-chat/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { validateWebchatContent } from '../../chat-limits.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';

const CLIENT_HEADER = 'x-xopc-client-instance-id';
const log = createGatewayRouteLogger('SideChats');

export function registerSideChatRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.post('/api/sessions/:parentSessionKey/side-chats', deps.chatRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const clientInstanceId = readClientInstanceId(c, body.clientInstanceId);
      if (body.modelRef !== undefined && typeof body.modelRef !== 'string') {
        throw new SideChatError('modelRef must be a string', 'INVALID_REQUEST');
      }
      const modelRef = typeof body.modelRef === 'string' ? body.modelRef : undefined;
      let selections;
      try {
        selections = validateSideChatSelections(body.selections);
      } catch (error) {
        throw new SideChatError(error instanceof Error ? error.message : 'Invalid selections', 'INVALID_REQUEST');
      }
      const sideChat = await service.sideChats.create({
        parentSessionKey: c.req.param('parentSessionKey'),
        clientInstanceId,
        selections,
        config: {
          modelRef,
          thinkingLevel: parseThinkingLevel(body.thinkingLevel),
        },
      });
      return c.json({ ok: true, sideChat }, 201);
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.get('/api/side-chats/:sideChatId', (c) => {
    try {
      const sideChat = service.sideChats.get(c.req.param('sideChatId'), readClientInstanceId(c));
      return c.json({ ok: true, sideChat });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.get('/api/side-chats/:sideChatId/messages', (c) => {
    try {
      const messages = service.sideChats.getMessages(c.req.param('sideChatId'), readClientInstanceId(c));
      return c.json({ ok: true, messages });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.patch('/api/side-chats/:sideChatId/config', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      if (body.modelRef !== undefined && typeof body.modelRef !== 'string') {
        throw new SideChatError('modelRef must be a string', 'INVALID_REQUEST');
      }
      const modelRef = typeof body.modelRef === 'string' ? body.modelRef : undefined;
      const sideChat = service.sideChats.updateConfig(
        c.req.param('sideChatId'),
        readClientInstanceId(c, body.clientInstanceId),
        {
          modelRef,
          thinkingLevel: parseThinkingLevel(body.thinkingLevel),
        },
      );
      return c.json({ ok: true, sideChat });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.post('/api/side-chats/:sideChatId/heartbeat', (c) => {
    try {
      const sideChat = service.sideChats.heartbeat(c.req.param('sideChatId'), readClientInstanceId(c));
      return c.json({ ok: true, sideChat });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.post('/api/side-chats/:sideChatId/inputs', deps.chatRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const content = typeof body.content === 'string' ? body.content : '';
      const contentError = validateWebchatContent(content);
      if (contentError) throw new SideChatError(contentError, 'INVALID_REQUEST');
      const result = service.sideChatRuns.submit(
        c.req.param('sideChatId'),
        readClientInstanceId(c, body.clientInstanceId),
        content,
      );
      return c.json({ ok: true, payload: result }, 202);
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.post('/api/side-chats/:sideChatId/abort', deps.chatRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const aborted = await service.sideChatRuns.abort(
        c.req.param('sideChatId'),
        readClientInstanceId(c, body.clientInstanceId),
        typeof body.runId === 'string' ? body.runId : undefined,
      );
      return c.json({ ok: true, payload: { aborted } });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.post('/api/side-chats/:sideChatId/clarify/:requestId', deps.chatRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const answer = body.skip === true ? '' : typeof body.answer === 'string' ? body.answer.trim() : '';
      if (body.skip !== true && !answer) throw new SideChatError('answer is required', 'INVALID_REQUEST');
      const handled = service.sideChatRuns.submitClarification(
        c.req.param('sideChatId'),
        readClientInstanceId(c, body.clientInstanceId),
        c.req.param('requestId'),
        answer,
      );
      if (!handled) throw new SideChatError('Clarification request not found', 'NOT_FOUND');
      return c.json({ ok: true });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.delete('/api/side-chats/:sideChatId', async (c) => {
    try {
      const removed = await service.sideChatRuns.dispose(c.req.param('sideChatId'), readClientInstanceId(c));
      return removed ? c.json({ ok: true }) : c.json({ ok: false, error: 'Side chat not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });

  authenticated.delete('/api/side-chats', async (c) => {
    try {
      const removed = await service.sideChats.disposeClient(readClientInstanceId(c, c.req.query('clientInstanceId')));
      return c.json({ ok: true, removed });
    } catch (error) {
      return respondSideChatError(c, error);
    }
  });
}

function readClientInstanceId(c: Context, fallback?: unknown): string {
  const value = c.req.header(CLIENT_HEADER) || (typeof fallback === 'string' ? fallback : '');
  if (!value.trim()) throw new SideChatError('clientInstanceId is required', 'INVALID_REQUEST');
  return value.trim();
}

function respondSideChatError(c: Context, error: unknown): Response {
  if (!(error instanceof SideChatError)) {
    logRouteError(log, c, error, 'Side chat request failed');
    return c.json({ ok: false, error: 'Side chat request failed', code: 'INTERNAL_ERROR' }, 500);
  }
  const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : error.code === 'LIMIT_REACHED' ? 429 : 400;
  return c.json({ ok: false, error: error.message, code: error.code }, status);
}
