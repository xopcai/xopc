import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { getGatewayPrincipal } from '../../gateway/security/gateway-principal.js';
import { CapabilityError, type CapabilityContext } from '../runtime/dispatcher.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Capabilities:Http');

export function capabilityHttpContext(c: Context): CapabilityContext {
  const principal = getGatewayPrincipal(c);
  return {
    principalId: principal.principalId, surface: 'http', scopes: principal.scopes,
    actor: { kind: 'user', id: principal.principalId },
    // The personal Gateway's domain collections share its authenticated scope boundary.
    authorize: () => true,
    signal: c.req.raw.signal,
  };
}

export function capabilityHttpError(c: Context, error: unknown): Response {
  const code = error instanceof CapabilityError ? error.code : 'INTERNAL';
  if (code === 'INTERNAL') log.error({ err: error, path: c.req.path, phase: 'invoke' }, 'Capability execution failed');
  const status: ContentfulStatusCode = code === 'INVALID_INPUT' ? 400 : code === 'FORBIDDEN' ? 403
    : code === 'NOT_FOUND' ? 404 : ['CONTRACT_CHANGED', 'REVISION_CONFLICT', 'IN_PROGRESS', 'OUTCOME_UNKNOWN'].includes(code) ? 409
      : code === 'UNAVAILABLE' ? 503 : code === 'CANCELLED' ? 409 : 500;
  return c.json({ ok: false, code, error: error instanceof CapabilityError ? error.message : 'Capability execution failed',
    ...(error instanceof CapabilityError && error.operationId ? { operationId: error.operationId } : {}) }, status);
}
