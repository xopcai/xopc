import { createMiddleware } from 'hono/factory';
import type { GatewayAuthConfig } from '../../../config/schema.js';
import {
  getAuthFailureRateLimiter,
  getClientIpFromHeaders,
  isAuthRateLimitGloballyDisabled,
  resolveAuthRateLimitConfig,
} from '../../auth-rate-limit.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Auth');

export interface AuthConfig {
  token?: string;
  /** Current gateway auth from config (for rate-limit settings); optional. */
  getGatewayAuth?: () => GatewayAuthConfig | undefined;
}

/**
 * Validate token from header or query parameter
 */
function validateToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken) return false;
  return providedToken === expectedToken;
}

/**
 * Extract token from Authorization header
 * Supports: "Bearer <token>", "<token>"
 */
function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return authHeader;
}

/**
 * Extract token from query parameter
 */
function extractTokenFromQuery(url: string): string | null {
  const parsed = new URL(url);
  return parsed.searchParams.get('token');
}

/**
 * Create auth middleware for HTTP routes
 */
export function auth(config?: AuthConfig) {
  const { token, getGatewayAuth } = config || {};
  const limiter = getAuthFailureRateLimiter();

  return createMiddleware(async (c, next) => {
    // If no token configured, allow all
    if (!token) {
      return next();
    }

    const rlInput = getGatewayAuth?.()?.rateLimit;
    const rlCfg = resolveAuthRateLimitConfig(rlInput);
    const rateLimitActive =
      rlCfg.enabled && !isAuthRateLimitGloballyDisabled();

    const clientIp = getClientIpFromHeaders({
      get: (name: string) => c.req.header(name) ?? undefined,
    });

    // Try header first, then query param
    const authHeader = extractTokenFromHeader(c.req.header('authorization'));
    const queryToken = extractTokenFromQuery(c.req.url);

    const providedToken = authHeader || queryToken;

    // Allow valid credentials to pass immediately and clear historical failures for this client.
    // This avoids lockout after a user fixes token configuration.
    if (providedToken && validateToken(providedToken, token)) {
      if (rateLimitActive) {
        limiter.recordSuccess(clientIp);
      }
      await next();
      return;
    }

    if (rateLimitActive) {
      const blocked = limiter.checkBlocked(clientIp, rlCfg);
      if (blocked.blocked) {
        c.header('Retry-After', String(blocked.retryAfterSec));
        return c.json(
          {
            error: 'Too Many Requests',
            message: 'Too many authentication attempts',
            retryAfter: blocked.retryAfterSec,
          },
          429,
        );
      }
    }

    if (!providedToken) {
      if (rateLimitActive) {
        limiter.recordFailure(clientIp, rlCfg);
      }
      log.warn(
        { path: c.req.path, method: c.req.method, clientIp, reason: 'missing_token' },
        'HTTP auth rejected: no Bearer or ?token=',
      );
      return c.json({ error: 'Unauthorized', message: 'Missing authentication token' }, 401);
    }

    if (!validateToken(providedToken, token)) {
      if (rateLimitActive) {
        limiter.recordFailure(clientIp, rlCfg);
      }
      log.warn(
        { path: c.req.path, method: c.req.method, clientIp, reason: 'invalid_token' },
        'HTTP auth rejected: token mismatch',
      );
      return c.json({ error: 'Unauthorized', message: 'Invalid authentication token' }, 401);
    }
  });
}

export interface WebSocketAuthResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate WebSocket connection token
 */
export function validateWebSocketAuth(
  url: URL,
  authHeader: string | null,
  expectedToken?: string
): WebSocketAuthResult {
  // If no token configured, allow all
  if (!expectedToken) {
    return { valid: true };
  }

  // Extract token from query param or header
  const queryToken = url.searchParams.get('token');
  const headerToken = extractTokenFromHeader(authHeader);

  const providedToken = queryToken || headerToken;

  if (!providedToken) {
    log.warn(
      { path: url.pathname, reason: 'missing_token', hasHeaderToken: Boolean(headerToken) },
      'WebSocket auth rejected: no token in query or Authorization',
    );
    return { valid: false, error: 'Missing authentication token' };
  }

  if (!validateToken(providedToken, expectedToken)) {
    log.warn({ path: url.pathname, reason: 'invalid_token' }, 'WebSocket auth rejected: token mismatch');
    return { valid: false, error: 'Invalid authentication token' };
  }

  return { valid: true };
}
