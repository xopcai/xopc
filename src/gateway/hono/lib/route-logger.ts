import type { Context } from 'hono';

import { createLogger, type ContextualLogger } from '../../../utils/logger.js';

/** Stable gateway route logger prefix: `Gateway:<Name>`. */
export function createGatewayRouteLogger(name: string): ContextualLogger {
  return createLogger(`Gateway:${name}`);
}

export function logRouteError(
  log: ContextualLogger,
  c: Context,
  err: unknown,
  phase: string,
  extra?: Record<string, unknown>,
): void {
  const em = err instanceof Error ? err.message : String(err);
  log.error(
    {
      err,
      errorMessage: em,
      phase,
      method: c.req.method,
      path: c.req.path,
      ...extra,
    },
    `Route error ${c.req.method} ${c.req.path}: ${em}`,
  );
}

export function logRouteWarn(
  log: ContextualLogger,
  c: Context,
  message: string,
  phase: string,
  extra?: Record<string, unknown>,
): void {
  log.warn(
    {
      phase,
      method: c.req.method,
      path: c.req.path,
      ...extra,
    },
    message,
  );
}
