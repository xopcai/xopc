import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { assistText, streamTextAssist, type TextAssistRequest } from '../../../ai-assist/text-assist.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';
import { stringifySSEData } from '../sse-json.js';

const log = createGatewayRouteLogger('AiAssist');

function isTextAssistIntent(value: unknown): boolean {
  return value === undefined || value === 'improve' || value === 'expand' || value === 'shorten' || value === 'fix';
}

export function registerAiAssistRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.post('/api/ai/text-assist', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
    }

    const request = body as TextAssistRequest;
    if (!isTextAssistIntent(request.intent)) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid intent' } }, 400);
    }
    if (request.input !== undefined && typeof request.input !== 'string') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } }, 400);
    }

    const accept = c.req.header('Accept') || '';
    const wantSSE = accept.includes('text/event-stream');
    if (wantSSE) {
      c.header('X-Accel-Buffering', 'no');
      return streamSSE(c, async (stream) => {
        let eventId = 0;
        const generator = streamTextAssist(request, service.currentConfig, c.req.raw.signal);
        try {
          for await (const event of generator) {
            await stream.writeSSE({
              id: String(++eventId),
              event: event.type,
              data: stringifySSEData(event),
            });
          }
        } catch (err) {
          logRouteError(log, c, err, 'gateway.route.ai_assist', { operation: 'textAssistStream' });
          await stream.writeSSE({
            id: String(++eventId),
            event: 'error',
            data: stringifySSEData({
              type: 'error',
              message: err instanceof Error ? err.message : 'AI text assist failed',
            }),
          });
        }
      });
    }

    try {
      const result = await assistText(request, service.currentConfig, c.req.raw.signal);
      return c.json(result);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.ai_assist', { operation: 'textAssist' });
      return c.json(
        {
          error: {
            code: 'AI_ASSIST_FAILED',
            message: err instanceof Error ? err.message : 'AI text assist failed',
          },
        },
        500,
      );
    }
  });
}
