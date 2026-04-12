/**
 * Logger Context
 * Context tracking and propagation for structured logging
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogContext, ContextualLogger } from './types.js';

const contextStore = new Map<string, LogContext>();

/** Correlation fields merged into every log line while the store is active (via pino mixin). */
const ASYNC_LOG_CORRELATION_KEYS = ['requestId', 'sessionId', 'userId', 'correlationId'] as const;

type AsyncLogCorrelationKey = (typeof ASYNC_LOG_CORRELATION_KEYS)[number];

const logContextStorage = new AsyncLocalStorage<{ ctx: LogContext }>();

/**
 * Run *fn* with merged async log context. Propagates through async/await (Node AsyncLocalStorage).
 * Nested calls merge over the parent context (shallow per key).
 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  const parent = logContextStorage.getStore();
  const merged = parent ? mergeContext(parent.ctx, context) : { ...context };
  return logContextStorage.run({ ctx: { ...merged } }, fn);
}

/** Current async log context, if any. */
export function getAsyncLogContext(): LogContext | undefined {
  return logContextStorage.getStore()?.ctx;
}

/**
 * Shallow-merge fields into the current async log context (e.g. set sessionId after parsing a body).
 * No-op when not inside {@link runWithLogContext}.
 */
export function updateAsyncLogContext(partial: LogContext): void {
  const ref = logContextStorage.getStore();
  if (ref) {
    ref.ctx = mergeContext(ref.ctx, partial);
  }
}

/** Keys injected from async context into log records (used by logger mixin). */
export function getAsyncLogCorrelationKeys(): readonly AsyncLogCorrelationKey[] {
  return ASYNC_LOG_CORRELATION_KEYS;
}

/**
 * Fields to copy from ALS onto {@link InboundMessage.metadata} when the gateway enqueues
 * a message for the agent bus. Omits `sessionId` so channel routing / sessionKey stays
 * authoritative; the agent sets log sessionId after `routeMessage`.
 */
const INBOUND_METADATA_FROM_ASYNC: readonly (keyof LogContext)[] = [
  'requestId',
  'correlationId',
  'userId',
];

export function inboundCorrelationMetadataFromAsyncLogContext(): Record<string, unknown> | undefined {
  const ctx = getAsyncLogContext();
  if (!ctx) return undefined;
  const meta: Record<string, unknown> = {};
  for (const key of INBOUND_METADATA_FROM_ASYNC) {
    const v = ctx[key];
    if (v !== undefined && v !== '') {
      meta[key] = v;
    }
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Merge two contexts
 */
export function mergeContext(base: LogContext, additional: LogContext): LogContext {
  return { ...base, ...additional };
}

/**
 * Store context for a request ID
 */
export function setRequestContext(requestId: string, context: LogContext): void {
  contextStore.set(requestId, context);
}

/**
 * Get context for a request ID
 */
export function getRequestContext(requestId: string): LogContext | undefined {
  return contextStore.get(requestId);
}

/**
 * Clear context for a request ID
 */
export function clearRequestContext(requestId: string): void {
  contextStore.delete(requestId);
}

/**
 * Create a child logger with additional context
 * This is a placeholder for the actual implementation
 */
export function withContext(logger: ContextualLogger, context: LogContext): ContextualLogger {
  return logger.withContext(context);
}
