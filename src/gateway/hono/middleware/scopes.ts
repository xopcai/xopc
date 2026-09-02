import { createMiddleware } from 'hono/factory';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { hasGatewayScope, requiredGatewayScope } from '../../security/gateway-scopes.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Scopes');

/** Enforces fail-closed route scopes after authentication establishes a principal. */
export function gatewayScopes() {
  return createMiddleware(async (c, next) => {
    const principal = getGatewayPrincipal(c);
    const requiredScope = requiredGatewayScope(c.req.method, c.req.path);
    if (!hasGatewayScope(principal.scopes, requiredScope)) {
      log.warn(
        { path: c.req.path, method: c.req.method, principalId: principal.principalId, requiredScope },
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
