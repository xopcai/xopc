import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import type { GatewayService } from '../service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Hono:SSE');

export interface SSEHandlerConfig {
  service: GatewayService;
}

/**
 * POST /api/agent — Send a message to the agent, stream response via SSE.
 *
 * Request body: { message, channel?, chatId?, attachments? }
 * Accept: text/event-stream → SSE stream
 * Accept: application/json → wait for full response, return JSON
 *
 * SSE events:
 *   event: status   — { status, runId }
 *   event: token    — { content }
 *   event: error    — { content }
 *   event: result   — { ok, payload: { status, summary } }
 */
export function createAgentSSEHandler(config: SSEHandlerConfig) {
  const { service } = config;

  return async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const message = body.message as string | undefined;
    const channel = (body.channel as string) || 'gateway';
    const chatId = (body.chatId as string) || 'default';
    const attachments = body.attachments as Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }> | undefined;

    if (!message) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing required field: message' } }, 400);
    }

    const accept = c.req.header('Accept') || '';
    const wantSSE = accept.includes('text/event-stream');
    const generator = service.runAgent(message, channel, chatId, attachments);

    // --- Non-streaming fallback: collect everything, return JSON ---
    if (!wantSSE) {
      try {
        let finalResult: { status: string; summary: string } | undefined;
        const tokens: string[] = [];

        while (true) {
          const { done, value } = await generator.next();
          if (done) {
            finalResult = value as { status: string; summary: string };
            break;
          }
          const chunk = value as { type: string; content?: string; status?: string; runId?: string };
          if (chunk.type === 'token' && chunk.content) {
            tokens.push(chunk.content);
          }
        }

        return c.json({
          ok: true,
          payload: {
            ...finalResult,
            content: tokens.join(''),
          },
        });
      } catch (error) {
        log.error({ err: error }, 'Agent run failed (JSON mode)');
        return c.json({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
        }, 500);
      }
    }

    // --- SSE streaming ---
    return streamSSE(c, async (stream) => {
      let eventId = 0;

      try {
        while (true) {
          const { done, value } = await generator.next();

          if (done) {
            // Final result
            await stream.writeSSE({
              id: String(++eventId),
              event: 'result',
              data: JSON.stringify({ ok: true, payload: value }),
            });
            break;
          }

          const chunk = value as { type: string; content?: string; status?: string; runId?: string };

          // Intermediate events: status / token / error
          await stream.writeSSE({
            id: String(++eventId),
            event: chunk.type || 'message',
            data: JSON.stringify(chunk),
          });
        }
      } catch (error) {
        log.error({ err: error }, 'Agent run failed (SSE mode)');
        await stream.writeSSE({
          id: String(++eventId),
          event: 'error',
          data: JSON.stringify({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
          }),
        });
      }
    });
  };
}

/**
 * POST /api/send — Send a message through a channel (non-streaming).
 */
export function createSendHandler(config: SSEHandlerConfig) {
  const { service } = config;

  return async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel as string;
    const chatId = body.chatId as string;
    const content = body.content as string;

    if (!channel || !chatId || !content) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing required fields: channel, chatId, content' } },
        400,
      );
    }

    try {
      const result = await service.sendMessage(channel, chatId, content);
      return c.json({ ok: true, payload: result });
    } catch (error) {
      log.error({ err: error }, 'Send failed');
      return c.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' } },
        500,
      );
    }
  };
}

/**
 * GET /api/events — Server-pushed event stream (SSE).
 *
 * The client opens this long-lived connection to receive:
 *   - channel status changes
 *   - config reload notifications
 *   - cron execution results
 *   - any other server-initiated events
 *
 * Supports Last-Event-ID for reconnection.
 */
export function createEventsSSEHandler(config: SSEHandlerConfig) {
  const { service } = config;

  return async (c: Context) => {
    const lastEventId = c.req.header('Last-Event-ID') || undefined;
    const sessionId = c.req.header('X-Session-Id')
      || c.req.query('sessionId')
      || crypto.randomUUID();

    return streamSSE(c, async (stream) => {
      let aborted = false;

      // Send a hello event so the client knows the stream is established
      await stream.writeSSE({
        id: '0',
        event: 'connected',
        data: JSON.stringify({ sessionId }),
      });

      // Subscribe to service events
      const cleanup = service.subscribe(sessionId, async (event) => {
        if (aborted) return;
        try {
          await stream.writeSSE({
            id: event.id,
            event: event.type,
            data: JSON.stringify(event.payload),
          });
        } catch {
          // Stream closed, will be cleaned up by onAbort
        }
      });

      // Replay missed events on reconnect
      if (lastEventId) {
        const missed = service.getEventsSince(sessionId, lastEventId);
        for (const event of missed) {
          await stream.writeSSE({
            id: event.id,
            event: event.type,
            data: JSON.stringify(event.payload),
          });
        }
      }

      // Keep alive with periodic comments (every 30s)
      const keepAlive = setInterval(async () => {
        if (aborted) { clearInterval(keepAlive); return; }
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(keepAlive);
        }
      }, 30_000);

      // Block until aborted — streamSSE closes when the callback returns
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          aborted = true;
          clearInterval(keepAlive);
          cleanup();
          log.debug({ sessionId }, 'Event stream disconnected');
          resolve();
        });
      });
    });
  };
}
