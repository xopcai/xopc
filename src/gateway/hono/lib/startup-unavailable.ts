import type { Context } from 'hono';

import {
  buildStartupUnavailablePayload,
  type StartupUnavailableGatewayMethod,
} from '../../startup-readiness.js';

export function respondStartupUnavailable(
  c: Context,
  method: StartupUnavailableGatewayMethod,
  retryAfterMs = 500,
): Response {
  const payload = buildStartupUnavailablePayload({ method, retryAfterMs });
  const retrySeconds = Math.max(1, Math.ceil(payload.retryAfterMs / 1000));
  return c.json(payload, 503, {
    'Retry-After': String(retrySeconds),
  });
}
