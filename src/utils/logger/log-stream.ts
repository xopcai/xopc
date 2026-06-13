/**
 * Log Streaming Module - SSE real-time log delivery
 */

import type { LogLevel, LogEntry } from './types.js';
export type { LogLevel, LogEntry };

type LogSubscriber = (entry: LogEntry) => void;
const subscribers = new Set<LogSubscriber>();

const VALID_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

function subscribeToLogs(subscriber: LogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getSubscriberCount(): number {
  return subscribers.size;
}

export function hasSubscribers(): boolean {
  return subscribers.size > 0;
}

/** @internal Called from Pino live emit stream */
export function emitLogEntry(entry: LogEntry): void {
  if (subscribers.size === 0) return;

  for (const subscriber of subscribers) {
    try {
      subscriber(entry);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function parseAllowedLevels(levelsParam: string | null): LogLevel[] {
  if (!levelsParam) {
    return ['info', 'warn', 'error', 'fatal'];
  }
  return levelsParam
    .split(',')
    .filter((l): l is LogLevel => VALID_LEVELS.includes(l as LogLevel));
}

function createLogSseResponse(req: Request, allowedLevels: LogLevel[], moduleFilter: string | null): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (data: unknown) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      sendEvent({ type: 'connected', message: 'Log stream started' });

      const unsubscribe = subscribeToLogs((entry) => {
        if (!allowedLevels.includes(entry.level)) return;
        if (moduleFilter && entry.module !== moduleFilter) return;
        sendEvent(entry);
      });

      const heartbeat = setInterval(() => {
        try {
          sendEvent({ type: 'heartbeat', subscribers: getSubscriberCount() });
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Hono handler for `GET /api/logs/stream`. */
export function createLogSSEHandler(): (c: { req: { raw: Request; url: string } }) => Promise<Response> {
  return async (c) => {
    const url = new URL(c.req.url);
    const allowedLevels = parseAllowedLevels(url.searchParams.get('levels'));
    const moduleFilter = url.searchParams.get('module');
    return createLogSseResponse(c.req.raw, allowedLevels, moduleFilter);
  };
}
