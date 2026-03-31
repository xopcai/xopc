/**
 * Request-scoped context for structured logging fields (requestId, sessionId, userId, …).
 *
 * Wire `onRequest` / `onResponse` around a handling scope; use `getContext` with
 * `logger.withContext` when you need request fields on log lines.
 *
 *   import { ContextMiddleware } from './middleware/index.js';
 */

import { randomBytes } from 'crypto';
import type { LogContext } from '../../utils/logger.js';
import { logger as baseLogger } from '../../utils/logger.js';

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

  private generateRequestId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `req_${timestamp}_${random}`;
  }

  private extractSessionId(sessionKey: string): string {
    const parts = sessionKey.split(':');
    return parts.slice(0, 2).join(':');
  }

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

    log.debug(
      {
        requestId,
        sessionId: this.currentContext.sessionId,
        userId: context.userId,
        depth: this.contextDepth,
      },
      'Request context started',
    );

    return requestId;
  }

  onResponse(): void {
    this.contextDepth--;

    if (this.contextDepth <= 0) {
      this.currentContext = {};
      this.contextDepth = 0;
    }

    log.debug({ depth: this.contextDepth }, 'Request context ended');
  }

  getContext(): LogContext {
    return { ...this.currentContext };
  }

  getRequestId(): string | undefined {
    return this.currentContext.requestId;
  }

  extendContext(fields: Record<string, unknown>): void {
    this.currentContext = { ...this.currentContext, ...fields };
  }
}
