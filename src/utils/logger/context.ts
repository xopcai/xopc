/**
 * Logger Context
 * Context tracking and propagation for structured logging
 */

import type { LogContext, ContextualLogger } from './types.js';

const contextStore = new Map<string, LogContext>();

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
