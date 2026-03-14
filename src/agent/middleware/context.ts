/**
 * Context Middleware
 * 
 * Automatically injects request context into logs:
 * - requestId: Unique identifier for each request
 * - sessionId: Session identifier
 * - userId: User identifier (from session)
 * 
 * Usage:
 *   import { ContextMiddleware } from './middleware/context.js';
 *   
 *   const ctxMiddleware = new ContextMiddleware();
 *   
 *   // At the start of each request
 *   ctxMiddleware.onRequest({ sessionKey: 'telegram:123', userId: 'user123' });
 *   
 *   // In logger calls, context is automatically available
 *   logger.info('Processing request'); // { requestId: 'req_xxx', sessionId: 'telegram:123', userId: 'user123' }
 *   
 *   // At the end of request
 *   ctxMiddleware.onResponse();
 */

import { randomBytes } from 'crypto';
import type { LogContext, ContextualLogger } from '../../utils/logger/types.js';
import { logger as baseLogger } from '../../utils/logger/index.js';

const log = baseLogger.child({ module: 'ContextMiddleware' });

export interface RequestContext {
  sessionKey: string;
  userId?: string;
  channel?: string;
  chatId?: string;
  metadata?: Record<string, unknown>;
}

export class ContextMiddleware {
  private currentContext: LogContext = {};
  private contextDepth = 0;

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `req_${timestamp}_${random}`;
  }

  /**
   * Extract session ID from sessionKey
   */
  private extractSessionId(sessionKey: string): string {
    // sessionKey format: "channel:id" or "channel:id:subid"
    const parts = sessionKey.split(':');
    return parts.slice(0, 2).join(':');
  }

  /**
   * Start a new request context
   */
  onRequest(context: RequestContext): string {
    this.contextDepth++;
    const requestId = this.generateRequestId();
    
    this.currentContext = {
      requestId,
      sessionId: this.extractSessionId(context.sessionKey),
      userId: context.userId,
      module: context.channel,
      service: 'xopcbot',
      ...context.metadata,
    };

    log.debug({ 
      requestId, 
      sessionId: this.currentContext.sessionId,
      userId: context.userId,
      depth: this.contextDepth 
    }, 'Request context started');

    return requestId;
  }

  /**
   * End the current request context
   */
  onResponse(): void {
    this.contextDepth--;
    
    if (this.contextDepth <= 0) {
      this.currentContext = {};
      this.contextDepth = 0;
    }
    
    log.debug({ depth: this.contextDepth }, 'Request context ended');
  }

  /**
   * Get current context
   */
  getContext(): LogContext {
    return { ...this.currentContext };
  }

  /**
   * Get current request ID
   */
  getRequestId(): string | undefined {
    return this.currentContext.requestId;
  }

  /**
   * Add custom context fields
   */
  extendContext(fields: Record<string, unknown>): void {
    this.currentContext = { ...this.currentContext, ...fields };
  }

  /**
   * Create a logger with current context injected
   */
  createScopedLogger(baseLogger: ContextualLogger): ContextualLogger {
    if (!this.currentContext.requestId) {
      return baseLogger;
    }
    
    return baseLogger.withContext(this.currentContext);
  }
}

/**
 * Create a singleton instance for global use
 */
export const contextMiddleware = new ContextMiddleware();

/**
 * Helper to wrap async operations with context
 */
export async function withContext<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  contextMiddleware.onRequest(context);
  try {
    return await fn();
  } finally {
    contextMiddleware.onResponse();
  }
}

/**
 * Helper to wrap async operations with context and custom logger
 */
export async function withContextAndLogger<T>(
  context: RequestContext,
  logger: ContextualLogger,
  fn: (scopedLogger: ContextualLogger) => Promise<T>
): Promise<T> {
  const requestId = contextMiddleware.onRequest(context);
  const scopedLogger = contextMiddleware.createScopedLogger(logger);
  
  scopedLogger.debug({ requestId }, 'Starting scoped operation');
  
  try {
    return await fn(scopedLogger);
  } finally {
    contextMiddleware.onResponse();
  }
}
