import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { GatewayAuthConfig } from '../../../config/schema.js';
import {
  getClientIpFromHeaders,
  isAuthRateLimitGloballyDisabled,
  resolveAuthRateLimitConfig,
  resolveAuthRateLimitTracking,
} from '../../auth-rate-limit.js';
import type { ResolvedGatewayAuth } from '../../auth.js';
import { resolveClientIpFromRequest } from '../../client-ip.js';
import { safeEqualSecret } from '../../security/secret-equal.js';
import { authorizeTrustedProxy } from '../../trusted-proxy.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:Auth');

export interface AuthConfig {
  token?: string;
  /** Current gateway auth from config (for rate-limit settings); optional. */
  getGatewayAuth?: () => GatewayAuthConfig | undefined;
  getResolvedAuth?: () => ResolvedGatewayAuth;
  getTrustedProxyContext?: () => {
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  };
}

/**
 * Validate token using constant-time comparison to prevent timing attacks.
 */
function validateToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken) return false;
  return safeEqualSecret(providedToken, expectedToken);
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
 * Extract token from query parameter.
 *
 * SECURITY: query-string tokens leak into server logs, Referer headers, and
 * browser history. We accept them only for SSE/WebSocket connections where
 * the `Authorization` header cannot be set by `EventSource`. For normal REST
 * requests prefer the `Authorization: Bearer <token>` header.
 */
function extractTokenFromQuery(url: string): string | null {
  const parsed = new URL(url);
  return parsed.searchParams.get('token');
}

/** Paths where query-string token auth is acceptable (SSE / WebSocket). */
const QUERY_TOKEN_ALLOWED_PATHS = new Set(['/api/events', '/api/ws']);

function isQueryTokenAllowedPath(path: string): boolean {
  return QUERY_TOKEN_ALLOWED_PATHS.has(path) || path.startsWith('/api/events');
}

function resolveRemoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function resolveMiddlewareClientIp(
  c: Context,
  trustedProxies?: string[],
  allowRealIpFallback?: boolean,
): string {
  if (trustedProxies?.length) {
    return resolveClientIpFromRequest({
      remoteAddress: resolveRemoteAddress(c),
      getHeader: (name) => c.req.header(name),
      trustedProxies,
      allowRealIpFallback,
    });
  }
  return getClientIpFromHeaders({
    get: (name: string) => c.req.header(name) ?? undefined,
  });
}

/**
 * Create auth middleware for HTTP routes
 */
export function auth(config?: AuthConfig) {
  const { token, getGatewayAuth, getResolvedAuth, getTrustedProxyContext } = config || {};

  return createMiddleware(async (c, next) => {
    const resolvedAuth = getResolvedAuth?.();
    const authMode = resolvedAuth?.mode ?? (token ? 'token' : 'none');

    if (authMode === 'trusted-proxy') {
      const proxyContext = getTrustedProxyContext?.();
      const trustedProxies = proxyContext?.trustedProxies;
      const trustedProxyConfig = resolvedAuth?.trustedProxy;

      const rlInput = getGatewayAuth?.()?.rateLimit;
      const rlCfg = resolveAuthRateLimitConfig(rlInput);
      const rateLimitActive = rlCfg.enabled && !isAuthRateLimitGloballyDisabled();
      const clientIp = resolveMiddlewareClientIp(
        c,
        trustedProxies,
        proxyContext?.allowRealIpFallback,
      );
      const origin = c.req.header('origin');
      const tracking = resolveAuthRateLimitTracking({ clientIp, origin, cfg: rlCfg });
      const { limiter, key: rateLimitKey, cfg: activeRlCfg } = tracking;

      if (!trustedProxyConfig) {
        if (rateLimitActive) {
          limiter.recordFailure(rateLimitKey, activeRlCfg);
        }
        log.warn(
          { path: c.req.path, method: c.req.method, clientIp, reason: 'trusted_proxy_config_missing' },
          'HTTP auth rejected: trusted-proxy config missing',
        );
        return c.json({ error: 'Unauthorized', message: 'Trusted-proxy auth is not configured' }, 401);
      }

      const result = authorizeTrustedProxy({
        remoteAddress: resolveRemoteAddress(c),
        getHeader: (name) => c.req.header(name),
        trustedProxies,
        trustedProxyConfig,
      });

      if (result.ok) {
        if (rateLimitActive) {
          limiter.recordSuccess(rateLimitKey);
        }
        await next();
        return;
      }

      if (result.ok === false) {
        if (rateLimitActive) {
          const blocked = limiter.checkBlocked(rateLimitKey, activeRlCfg);
          if (blocked.blocked) {
            log.warn(
              {
                clientIp,
                origin: origin ?? undefined,
                path: c.req.path,
                method: c.req.method,
                attemptCount: activeRlCfg.maxAttempts,
                windowSec: Math.round(activeRlCfg.windowMs / 1000),
                blockDurationSec: Math.round(activeRlCfg.blockDurationMs / 1000),
                retryAfterSec: blocked.retryAfterSec,
                reason: 'auth_failure_rate_limit',
              },
              `Auth rate limit blocked: ${activeRlCfg.maxAttempts} failures in ${activeRlCfg.windowMs / 1000}s, blocking for ${activeRlCfg.blockDurationMs / 1000}s`,
            );
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
          limiter.recordFailure(rateLimitKey, activeRlCfg);
        }

        log.warn(
          {
            path: c.req.path,
            method: c.req.method,
            clientIp,
            reason: result.reason,
          },
          `HTTP auth rejected: trusted-proxy validation failed (${result.reason})`,
        );
        return c.json({ error: 'Unauthorized', message: 'Trusted-proxy authentication failed' }, 401);
      }
    }

    if (authMode === 'none' || !token) {
      return next();
    }

    const rlInput = getGatewayAuth?.()?.rateLimit;
    const rlCfg = resolveAuthRateLimitConfig(rlInput);
    const rateLimitActive = rlCfg.enabled && !isAuthRateLimitGloballyDisabled();

    const proxyContext = getTrustedProxyContext?.();
    const clientIp = resolveMiddlewareClientIp(
      c,
      proxyContext?.trustedProxies,
      proxyContext?.allowRealIpFallback,
    );
    const origin = c.req.header('origin');
    const tracking = resolveAuthRateLimitTracking({ clientIp, origin, cfg: rlCfg });
    const { limiter, key: rateLimitKey, cfg: activeRlCfg } = tracking;

    const authHeader = extractTokenFromHeader(c.req.header('authorization'));
    const requestPath = new URL(c.req.url).pathname;
    const queryToken = isQueryTokenAllowedPath(requestPath)
      ? extractTokenFromQuery(c.req.url)
      : null;

    if (!authHeader && queryToken === null && new URL(c.req.url).searchParams.has('token')) {
      log.warn(
        { path: requestPath, method: c.req.method, clientIp },
        'Token in query string rejected: use Authorization header for this endpoint',
      );
    }

    const providedToken = authHeader || queryToken;

    if (providedToken && validateToken(providedToken, token)) {
      if (rateLimitActive) {
        limiter.recordSuccess(rateLimitKey);
      }
      await next();
      return;
    }

    if (rateLimitActive) {
      const blocked = limiter.checkBlocked(rateLimitKey, activeRlCfg);
      if (blocked.blocked) {
        log.warn(
          {
            clientIp,
            origin: origin ?? undefined,
            path: requestPath,
            method: c.req.method,
            attemptCount: activeRlCfg.maxAttempts,
            windowSec: Math.round(activeRlCfg.windowMs / 1000),
            blockDurationSec: Math.round(activeRlCfg.blockDurationMs / 1000),
            retryAfterSec: blocked.retryAfterSec,
            reason: 'auth_failure_rate_limit',
          },
          `Auth rate limit blocked: ${activeRlCfg.maxAttempts} failures in ${activeRlCfg.windowMs / 1000}s, blocking for ${activeRlCfg.blockDurationMs / 1000}s`,
        );
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
        limiter.recordFailure(rateLimitKey, activeRlCfg);
      }
      log.warn(
        { path: c.req.path, method: c.req.method, clientIp, reason: 'missing_token' },
        'HTTP auth rejected: no Bearer or ?token=',
      );
      return c.json({ error: 'Unauthorized', message: 'Missing authentication token' }, 401);
    }

    if (!validateToken(providedToken, token)) {
      if (rateLimitActive) {
        limiter.recordFailure(rateLimitKey, activeRlCfg);
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
  if (!expectedToken) {
    return { valid: true };
  }

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

  if (!safeEqualSecret(providedToken, expectedToken)) {
    log.warn({ path: url.pathname, reason: 'invalid_token' }, 'WebSocket auth rejected: token mismatch');
    return { valid: false, error: 'Invalid authentication token' };
  }

  return { valid: true };
}
