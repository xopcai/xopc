import { randomUUID } from 'node:crypto';

import { createMiddleware } from 'hono/factory';

import { runWithActivityContext } from '../../../activity/index.js';
import { runWithLogContext } from '../../../utils/logger/context.js';

/**
 * Binds request (and optional session) correlation into AsyncLocalStorage so
 * all pino logs in the request inherit requestId / sessionId without a child logger.
 */
export function logContextMiddleware() {
  return createMiddleware(async (c, next) => {
    const headerRequestId = c.req.header('x-request-id')?.trim();
    const requestId = headerRequestId && headerRequestId.length > 0 ? headerRequestId : randomUUID();
    const sessionHeader = c.req.header('x-session-id')?.trim();

    c.header('X-Request-Id', requestId);

    return runWithLogContext(
      {
        requestId,
        ...(sessionHeader ? { sessionId: sessionHeader } : {}),
      },
      async () => {
        await runWithActivityContext(
          { source: { kind: 'gateway_api', requestId } },
          async () => {
            await next();
          },
        );
      },
    );
  });
}
