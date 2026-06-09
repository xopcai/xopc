import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import type { GatewayAuthConfig } from '../../../config/schema.js';
import type { ResolvedGatewayAuth } from '../../auth.js';
import { resolveClientIpFromRequest } from '../../client-ip.js';
import {
  authPolicyConfig,
  buckets,
  isAuthRateLimitGloballyDisabled,
  resolveAuthRateLimit,
  resolveAuthTracking,
  type ResolvedAuthRateLimitConfig,
} from '../../rate-limit/index.js';
import { getClientIpFromHeaders } from '../../security/loopback.js';
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

function validateToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken) return false;
  return safeEqualSecret(providedToken, expectedToken);
}

function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return authHeader;
}

/**
 * SECURITY: query-string tokens leak into server logs, Referer headers, and
 * browser history. We accept them only where the `Authorization` header cannot
 * be set — SSE/WebSocket (`EventSource`) and `<img>` subresource loads for agent
 * avatars. Note media uses Bearer-authenticated blob fetch in the gateway console.
 */
function extractTokenFromQuery(url: string): string | null {
  return new URL(url).searchParams.get('token');
}

const QUERY_TOKEN_ALLOWED_PATHS = new Set(['/api/events', '/api/ws']);

const AGENT_AVATAR_GET_PATH = /^\/api\/agents\/[^/]+\/avatar$/;

/** Exported for gateway security tests. */
export function isQueryTokenAllowedPath(path: string, method: string): boolean {
  if (QUERY_TOKEN_ALLOWED_PATHS.has(path) || path.startsWith('/api/events')) {
    return true;
  }
  if (method === 'GET' && AGENT_AVATAR_GET_PATH.test(path)) {
    return true;
  }
  return false;
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

type RateLimitContext = {
  active: boolean;
  cfg: ResolvedAuthRateLimitConfig;
  /** `undefined` when the client is exempted (loopback, disabled, etc.). */
  trackingKey: string | undefined;
};

function buildRateLimitContext(
  getGatewayAuth: AuthConfig['getGatewayAuth'],
  clientIp: string,
  origin: string | undefined,
): RateLimitContext {
  const cfg = resolveAuthRateLimit(getGatewayAuth?.()?.rateLimit);
  const active = cfg.enabled && !isAuthRateLimitGloballyDisabled();
  if (!active) return { active: false, cfg, trackingKey: undefined };
  const tracking = resolveAuthTracking({ clientIp, origin, cfg: authPolicyConfig(cfg) });
  return {
    active: true,
    cfg,
    trackingKey: tracking.exempt ? undefined : tracking.key,
  };
}

function checkBlocked(rl: RateLimitContext): { blocked: false } | { blocked: true; retryAfterSec: number } {
  if (!rl.active || rl.trackingKey === undefined) return { blocked: false };
  return buckets.authFailure(rl.cfg).check(rl.trackingKey);
}

function recordFailure(rl: RateLimitContext): void {
  if (!rl.active || rl.trackingKey === undefined) return;
  buckets.authFailure(rl.cfg).fail(rl.trackingKey);
}

function recordSuccess(rl: RateLimitContext): void {
  if (!rl.active || rl.trackingKey === undefined) return;
  buckets.authFailure(rl.cfg).succeed(rl.trackingKey);
}

function blockedResponse(c: Context, retryAfterSec: number) {
  c.header('Retry-After', String(retryAfterSec));
  return c.json(
    {
      error: 'Too Many Requests',
      code: 'auth_blocked',
      message: 'Too many authentication attempts',
      retryAfter: retryAfterSec,
    },
    429,
  );
}

export function auth(config?: AuthConfig) {
  const { token, getGatewayAuth, getResolvedAuth, getTrustedProxyContext } = config || {};

  return createMiddleware(async (c, next) => {
    const resolvedAuth = getResolvedAuth?.();
    const authMode = resolvedAuth?.mode ?? (token ? 'token' : 'none');

    if (authMode === 'trusted-proxy') {
      const proxyContext = getTrustedProxyContext?.();
      const trustedProxies = proxyContext?.trustedProxies;
      const trustedProxyConfig = resolvedAuth?.trustedProxy;

      const clientIp = resolveMiddlewareClientIp(c, trustedProxies, proxyContext?.allowRealIpFallback);
      const origin = c.req.header('origin');
      const rl = buildRateLimitContext(getGatewayAuth, clientIp, origin);

      // Server misconfiguration — not an attack signal. Don't count.
      if (!trustedProxyConfig) {
        log.warn(
          { path: c.req.path, method: c.req.method, clientIp, reason: 'trusted_proxy_config_missing' },
          'HTTP auth rejected: trusted-proxy config missing',
        );
        return c.json(
          { error: 'Unauthorized', code: 'auth_unconfigured', message: 'Trusted-proxy auth is not configured' },
          401,
        );
      }

      const blocked = checkBlocked(rl);
      if (blocked.blocked) {
        log.warn(
          { clientIp, origin: origin ?? undefined, path: c.req.path, method: c.req.method, retryAfterSec: blocked.retryAfterSec, reason: 'auth_blocked' },
          'Auth rate limit blocked',
        );
        return blockedResponse(c, blocked.retryAfterSec);
      }

      const result = authorizeTrustedProxy({
        remoteAddress: resolveRemoteAddress(c),
        getHeader: (name) => c.req.header(name),
        trustedProxies,
        trustedProxyConfig,
      });

      if (result.ok === false) {
        recordFailure(rl);
        log.warn(
          { path: c.req.path, method: c.req.method, clientIp, reason: result.reason },
          `HTTP auth rejected: trusted-proxy validation failed (${result.reason})`,
        );
        return c.json(
          { error: 'Unauthorized', code: 'invalid_proxy_credentials', message: 'Trusted-proxy authentication failed' },
          401,
        );
      }

      recordSuccess(rl);
      await next();
      return;
    }

    if (authMode === 'none' || !token) {
      return next();
    }

    const proxyContext = getTrustedProxyContext?.();
    const clientIp = resolveMiddlewareClientIp(c, proxyContext?.trustedProxies, proxyContext?.allowRealIpFallback);
    const origin = c.req.header('origin');
    const rl = buildRateLimitContext(getGatewayAuth, clientIp, origin);

    const authHeader = extractTokenFromHeader(c.req.header('authorization'));
    const requestPath = new URL(c.req.url).pathname;
    const queryToken = isQueryTokenAllowedPath(requestPath, c.req.method)
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
      recordSuccess(rl);
      await next();
      return;
    }

    const blocked = checkBlocked(rl);
    if (blocked.blocked) {
      log.warn(
        { clientIp, origin: origin ?? undefined, path: requestPath, method: c.req.method, retryAfterSec: blocked.retryAfterSec, reason: 'auth_blocked' },
        'Auth rate limit blocked',
      );
      return blockedResponse(c, blocked.retryAfterSec);
    }

    // Missing token is an unauthenticated request, not a brute-force signal —
    // page reloads / SDK cold starts often hit endpoints before the token is
    // attached. Counting this would lock users out of the token-entry path.
    if (!providedToken) {
      log.warn(
        { path: c.req.path, method: c.req.method, clientIp, reason: 'missing_token' },
        'HTTP auth rejected: no Bearer or ?token=',
      );
      return c.json(
        { error: 'Unauthorized', code: 'missing_token', message: 'Missing authentication token' },
        401,
      );
    }

    recordFailure(rl);
    log.warn(
      { path: c.req.path, method: c.req.method, clientIp, reason: 'invalid_token' },
      'HTTP auth rejected: token mismatch',
    );
    return c.json(
      { error: 'Unauthorized', code: 'invalid_token', message: 'Invalid authentication token' },
      401,
    );
  });
}
