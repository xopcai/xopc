import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import type { GatewayService } from '../service.js';
import { createLogger, updateAsyncLogContext } from '../../utils/logger.js';
import { stringifySSEData } from './sse-json.js';

const log = createLogger('Gateway:SSE');

// Active SSE connections tracking for connection limiting
const activeConnections = new Map<string, AbortController>();

/** Close long-lived gateway event streams before the HTTP server starts draining. */
export function closeAllEventStreams(): void {
  for (const controller of activeConnections.values()) {
    controller.abort();
  }
}

export interface SSEHandlerConfig {
  service: GatewayService;
  maxSseConnections?: number;
}

/**
 * POST /api/agent/resume — Re-attach to an in-progress agent run via SSE.
 *
 * Request body: { runId, sessionKey }
 * The relay replays retained buffered events from the beginning and then live-tails
 * until the run completes.
 *
 * SSE events are the active run's retained and live stream events.
 */
export function createAgentResumeHandler(config: SSEHandlerConfig) {
  const { service } = config;

  return async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
    }

    const { runId, sessionKey } = body as { runId?: string; sessionKey?: string };
    if (typeof sessionKey === 'string' && sessionKey.trim()) {
      updateAsyncLogContext({ sessionKey: sessionKey.trim() });
    }
    if (!runId || typeof runId !== 'string') {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing required field: runId' } }, 400);
    }

    if (!service.agentRunner.runRelay.hasRun(runId)) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Run not found or already expired' } }, 404);
    }

    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let eventId = 0;
      try {
        for await (const event of service.agentRunner.runRelay.subscribe(runId)) {
          await stream.writeSSE({
            id: typeof event.seq === 'number' ? String(event.seq) : String(++eventId),
            event: event.type || 'message',
            data: stringifySSEData(event),
          });
        }
      } catch (error) {
        log.error({ err: error, runId }, 'Resume stream failed');
        await stream.writeSSE({
          id: String(++eventId),
          event: 'error',
          data: stringifySSEData({
            type: 'error',
            runId,
            sessionKey: typeof sessionKey === 'string' ? sessionKey : '',
            timestamp: Date.now(),
            payload: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
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
 * Enforces maximum connection limit to prevent DoS.
 */
export function createEventsSSEHandler(config: SSEHandlerConfig) {
  const { service } = config;
  const maxConnections = config.maxSseConnections ?? 100;

  return async (c: Context) => {
    // Check maximum connections limit
    if (activeConnections.size >= maxConnections) {
      log.warn({ current: activeConnections.size, max: maxConnections }, 'SSE connection limit reached');
      return c.json({
        ok: false,
        error: { code: 'TOO_MANY_CONNECTIONS', message: 'Maximum SSE connections exceeded' }
      }, 503);
    }

    const lastEventId = c.req.header('Last-Event-ID') || undefined;
    const sessionId = c.req.header('X-Session-Id')
      || c.req.query('sessionId')
      || crypto.randomUUID();

    updateAsyncLogContext({ sessionId: String(sessionId) });

    const abortController = new AbortController();
    activeConnections.set(sessionId, abortController);

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

      // Block until the client disconnects or gateway shutdown aborts the stream.
      await new Promise<void>((resolve) => {
        const finish = () => {
          aborted = true;
          clearInterval(keepAlive);
          cleanup();
          activeConnections.delete(sessionId);
          log.debug({ sessionId }, 'Event stream disconnected');
          resolve();
        };

        stream.onAbort(finish);
        abortController.signal.addEventListener('abort', () => stream.abort(), { once: true });
        if (abortController.signal.aborted) {
          stream.abort();
        }
      });
    });
  };
}
