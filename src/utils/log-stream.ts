/**
 * Log Streaming Module - SSE Real-time Log Delivery
 * 
 * Provides Server-Sent Events (SSE) for real-time log streaming:
 * - Subscribe to log events
 * - Filter by level and module
 * - Automatic cleanup on disconnect
 */

import { createServer } from 'http'; // eslint-disable-line @typescript-eslint/no-unused-vars

// =============================================================================
// Types
// =============================================================================

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  module?: string;
  prefix?: string;
  service?: string;
  extension?: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface LogStreamOptions {
  /** Minimum log level to stream */
  minLevel?: LogLevel;
  /** Filter by module name */
  module?: string;
  /** Include these levels (overrides minLevel) */
  levels?: LogLevel[];
}

// =============================================================================
// Internal State
// =============================================================================

type LogSubscriber = (entry: LogEntry) => void;
const subscribers = new Set<LogSubscriber>();

// Log level numeric values for comparison (reserved for future use)
const _LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Subscribe to log events
 * 
 * @param subscriber - Callback function to receive log entries
 * @returns Unsubscribe function
 */
export function subscribeToLogs(subscriber: LogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/**
 * Get number of active subscribers
 */
export function getSubscriberCount(): number {
  return subscribers.size;
}

/**
 * Check if any subscribers are active
 */
export function hasSubscribers(): boolean {
  return subscribers.size > 0;
}

/**
 * Emit a log entry to all subscribers
 * 
 * @internal - Called by the logger integration
 */
export function emitLogEntry(entry: LogEntry): void {
  if (subscribers.size === 0) return;
  
  for (const subscriber of subscribers) {
    try {
      subscriber(entry);
    } catch {
      // Ignore subscriber errors
    }
  }
}

/**
 * Create a log entry from raw data
 * 
 * @internal
 */
export function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
}

// =============================================================================
// HTTP SSE Handler
// =============================================================================

/**
 * Create an SSE handler for log streaming
 * 
 * Usage:
 * ```typescript
 * import { createLogStreamHandler } from './log-stream.js';
 * 
 * app.get('/api/logs/stream', createLogStreamHandler());
 * ```
 */
export function createLogStreamHandler() {
  return (req: Request): Response => {
    const url = new URL(req.url);
    const levelsParam = url.searchParams.get('levels');
    const moduleFilter = url.searchParams.get('module');
    
    // Parse levels
    const allowedLevels: LogLevel[] = levelsParam 
      ? levelsParam.split(',') as LogLevel[]
      : ['info', 'warn', 'error', 'fatal'];
    
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        
        const sendEvent = (data: unknown) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        // Send connection message
        sendEvent({ type: 'connected', message: 'Log stream started' });

        // Subscribe to logs
        const unsubscribe = subscribeToLogs((entry) => {
          // Filter by level
          if (!allowedLevels.includes(entry.level)) return;
          
          // Filter by module
          if (moduleFilter && entry.module !== moduleFilter && entry.prefix !== moduleFilter) return;
          
          sendEvent(entry);
        });

        // Handle disconnect
        req.signal.addEventListener('abort', () => {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });

        // Send heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          try {
            sendEvent({ type: 'heartbeat', subscribers: getSubscriberCount() });
          } catch {
            clearInterval(heartbeat);
          }
        }, 30000);

        req.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  };
}

// =============================================================================
// Utility: Create SSE handler compatible with Hono
// =============================================================================

/**
 * Create a Hono-compatible SSE handler for log streaming
 * 
 * Usage:
 * ```typescript
 * import { createLogSSEHandler } from './log-stream.js';
 * 
 * app.get('/api/logs/stream', createLogSSEHandler());
 * ```
 */
export function createLogSSEHandler(): (c: { req: { raw: Request; url: string } }) => Promise<Response> {
  return async (c: { req: { raw: Request; url: string } }) => {
    const url = new URL(c.req.url);
    const levelsParam = url.searchParams.get('levels');
    const moduleFilter = url.searchParams.get('module');
    
    const allowedLevels: LogLevel[] = levelsParam
      ? levelsParam.split(',') as LogLevel[]
      : ['info', 'warn', 'error', 'fatal'];
    
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        
        const sendEvent = (data: unknown) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        // Send connection message
        sendEvent({ type: 'connected', message: 'Log stream started' });

        // Subscribe to logs
        const unsubscribe = subscribeToLogs((entry) => {
          if (!allowedLevels.includes(entry.level)) return;
          if (moduleFilter && entry.module !== moduleFilter && entry.prefix !== moduleFilter) return;
          
          sendEvent(entry);
        });

        // Handle disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });

        // Heartbeat
        const heartbeat = setInterval(() => {
          try {
            sendEvent({ type: 'heartbeat', subscribers: getSubscriberCount() });
          } catch {
            clearInterval(heartbeat);
          }
        }, 30000);

        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  };
}

export default {
  subscribeToLogs,
  getSubscriberCount,
  hasSubscribers,
  emitLogEntry,
  createLogEntry,
  createLogStreamHandler,
  createLogSSEHandler,
};
