import { createMiddleware } from 'hono/factory';
import { authorizeRouteScope, DEFAULT_OPERATOR_SCOPES, type OperatorScope } from '../../security/operator-scopes.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Scopes');

/**
 * Middleware that enforces operator scope requirements on API routes.
 *
 * This middleware runs AFTER the auth middleware. For authenticated requests,
 * it checks that the declared operator scopes (defaulting to full access for
 * token-authenticated users) satisfy the minimum scope required by the route.
 *
 * The scope system is currently implicit: all authenticated users get
 * DEFAULT_OPERATOR_SCOPES. This lays the groundwork for future per-device
 * or per-token scope restrictions (similar to OpenClaw's device pairing scopes).
 */
export function operatorScopes() {
  return createMiddleware(async (c, next) => {
    // All currently authenticated users get full operator scopes.
    // In the future, device-paired connections or scoped tokens can provide
    // a narrower set via x-xopc-scopes header or connect payload.
    const grantedScopes: OperatorScope[] = [...DEFAULT_OPERATOR_SCOPES];

    const scopeCheck = authorizeRouteScope(c.req.path, grantedScopes);
    if (!scopeCheck.allowed && 'requiredScope' in scopeCheck) {
      const { requiredScope } = scopeCheck;
      log.warn(
        { path: c.req.path, method: c.req.method, requiredScope },
        `Scope check failed: missing ${requiredScope}`,
      );
      return c.json(
        {
          error: 'Forbidden',
          message: `Missing required scope: ${requiredScope}`,
        },
        403,
      );
    }

    await next();
  });
}
