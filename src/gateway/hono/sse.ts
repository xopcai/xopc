import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import type { GatewayService } from '../service.js';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../chat-limits.js';
import { createLogger, updateAsyncLogContext } from '../../utils/logger.js';
import { stringifySSEData } from './sse-json.js';
import { resolveWebchatSessionKey } from '../resolve-webchat-session-key.js';
import type { UserTurnAttachment } from '../user-turn-input.js';

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

// Type validation for agent request body
interface AgentRequestBody {
  message: string;
  channel?: string;
  sessionKey?: string;
  /** Epoch ms when the client started this send (abort cutoff / stale POST drop). */
  clientCreatedAtMs?: number;
  thinking?: string;
  attachments?: UserTurnAttachment[];
}

function isValidAgentRequest(body: unknown): body is AgentRequestBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  // Allow empty message if attachments are provided
  const hasMessage = typeof b.message === 'string';
  const hasAttachments = Array.isArray(b.attachments) && b.attachments.length > 0;
  return hasMessage || hasAttachments;
}

/** Max base64 character length that can decode to `MAX_WEBCHAT_ATTACHMENT_FILE_BYTES`. */
function maxBase64CharsForBinary(maxBinaryBytes: number): number {
  return 4 * Math.ceil(maxBinaryBytes / 3);
}

/**
 * POST /api/agent — Send a message to the agent, stream response via SSE.
 *
 * Request body: { message, channel?, sessionKey, attachments? }
 * Accept: text/event-stream → SSE stream
 * Accept: application/json → wait for full response, return JSON
 *
 * SSE events follow XOPC Chat Stream Protocol v1:
 *   run_start, user_message, user_transcript, assistant_message_start,
 *   assistant_delta, thinking_delta, thinking_end, tool_start, tool_update,
 *   tool_end, review_start, review_delta, review_end, assistant_message_end,
 *   compaction, tts_audio, clarify_request,
 *   run_end, error.
 */
export function createAgentSSEHandler(config: SSEHandlerConfig) {
  const { service } = config;

  return async (c: Context) => {
    const body = await c.req.json().catch(() => null);

    // Input validation
    if (!isValidAgentRequest(body)) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Missing required field: message or attachments' }
      }, 400);
    }

    const { message, channel = 'webchat', attachments, thinking } = body;
    const clientCreatedAtMs =
      typeof body.clientCreatedAtMs === 'number' && Number.isFinite(body.clientCreatedAtMs)
        ? body.clientCreatedAtMs
        : undefined;
    const resolved = resolveWebchatSessionKey({
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
    });
    if (resolved.ok === false) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: resolved.error },
      }, 400);
    }
    const chatId = resolved.sessionKey;

    updateAsyncLogContext({ sessionKey: String(chatId) });

    if (Array.isArray(attachments)) {
      const maxDataChars = maxBase64CharsForBinary(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES);
      for (const a of attachments) {
        if (!a || typeof a !== 'object') continue;
        const data = (a as { data?: unknown }).data;
        if (typeof data === 'string' && data.length > maxDataChars) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'BAD_REQUEST',
                message: `Attachment exceeds maximum size (${MAX_WEBCHAT_ATTACHMENT_FILE_BYTES} bytes)`,
              },
            },
            400,
          );
        }
      }
    }

    const accept = c.req.header('Accept') || '';
    const wantSSE = accept.includes('text/event-stream');

    const clientAbort = new AbortController();
    const raw = c.req.raw;
    // Keep webchat runs alive across transient disconnects (page refresh / tab route switch)
    // so the client can reattach via /api/agent/resume using runId from `run_start`.
    // Explicit cancellation still goes through /api/agent/abort.
    if (channel !== 'webchat') {
      if (raw.signal.aborted) {
        clientAbort.abort();
      } else {
        raw.signal.addEventListener('abort', () => clientAbort.abort(), { once: true });
      }
    }

    // --- Non-streaming fallback: collect everything, return JSON ---
    if (!wantSSE) {
      const jsonSessionKey = channel === 'webchat' ? chatId : undefined;

      const generator = service.runAgent(message, channel, chatId, attachments, thinking, {
        signal: clientAbort.signal,
        ...(clientCreatedAtMs !== undefined ? { clientCreatedAtMs } : {}),
      });
      try {
        let finalResult: { status: string; summary: string } | undefined;
        const tokens: string[] = [];

        while (true) {
          const { done, value } = await generator.next();
          if (done) {
            finalResult = value as { status: string; summary: string };
            break;
          }
          const chunk = value as { type: string; payload?: { delta?: unknown } };
          if (chunk.type === 'assistant_delta' && typeof chunk.payload?.delta === 'string') {
            tokens.push(chunk.payload.delta);
          }
        }

        return c.json({
          ok: true,
          payload: {
            ...finalResult,
            content: tokens.join(''),
            ...(jsonSessionKey !== undefined
              ? { sessionKey: jsonSessionKey, key: jsonSessionKey }
              : {}),
          },
        });
      } catch (error) {
        const em = error instanceof Error ? error.message : String(error);
        log.error(
          { err: error, errorMessage: em, phase: 'gateway.agent_run', sessionKey: jsonSessionKey, channel },
          `Agent run failed (JSON mode): ${em}`,
        );
        return c.json({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
        }, 500);
      }
    }

    // --- SSE streaming ---
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      if (channel !== 'webchat') {
        stream.onAbort(() => {
          clientAbort.abort();
        });
      }

      const generator = service.runAgent(message, channel, chatId, attachments, thinking, {
        signal: clientAbort.signal,
        ...(clientCreatedAtMs !== undefined ? { clientCreatedAtMs } : {}),
      });

      let eventId = 0;

      try {
        while (true) {
          const { done, value } = await generator.next();

          if (done) break;

          const chunk = value as { type: string; seq?: unknown };
          await stream.writeSSE({
            id: typeof chunk.seq === 'number' ? String(chunk.seq) : String(++eventId),
            event: chunk.type || 'message',
            data: stringifySSEData(chunk),
          });
        }
      } catch (error) {
        log.error({ err: error }, 'Agent run failed (SSE mode)');
        await stream.writeSSE({
          id: String(++eventId),
          event: 'error',
          data: stringifySSEData({
            type: 'error',
            runId: 'unknown',
            sessionKey: chatId,
            timestamp: Date.now(),
            payload: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
          }),
        });
      }
    });
  };
}

/**
 * POST /api/agent/resume — Re-attach to an in-progress agent run via SSE.
 *
 * Request body: { runId, sessionKey }
 * The relay replays retained buffered events from the beginning and then live-tails
 * until the run completes.
 *
 * SSE events are identical to those from POST /api/agent.
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

    if (!service.runRelay.hasRun(runId)) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Run not found or already expired' } }, 404);
    }

    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let eventId = 0;
      try {
        for await (const event of service.runRelay.subscribe(runId)) {
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
