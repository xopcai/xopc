import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';

import { resolveGatewayEffectiveHost } from '../../config/gateway-bind.js';
import { createLogger } from '../../utils/logger.js';
import type { GatewayService } from '../service.js';
import { resolveAllowedBrowserOrigins, resolveGatewayServiceListenPort } from '../host.js';
import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import { maxWebchatAgentRequestBodyBytes } from '../chat-limits.js';
import { buildGatewayConsoleCspHeader } from '../security/csp.js';
import { checkBrowserOrigin } from '../security/origin-check.js';
import { auth } from './middleware/auth.js';
import { operatorScopes } from './middleware/scopes.js';
import { createStrictRateLimitMiddleware } from './middleware/strict-rate-limit.js';
import { logContextMiddleware } from './middleware/log-context.js';
import { logger } from './middleware/logger.js';
import { registerPublicExtensionAssetRoutes } from './routes/auth-registry-extensions.js';
import { registerAuthenticatedRoutes } from './routes/index.js';
import { registerPublicGatewayRoutes } from './routes/public-gateway.js';
import { resetLazyRouteBundlesForTests } from './routes/lazy-fallback.js';
import { prewarmStaticUiCache } from './lib/static-ui.js';
const log = createLogger('HonoApp');

export interface HonoAppConfig {
  service: GatewayService;
  token?: string;
}

/**
 * Extension sandbox HTML under `/api/extensions/:id/assets/*` ships its own CSP
 * (`frame-ancestors 'self'`). The global gateway middleware must not overwrite it
 * with `frame-ancestors 'none'` / `X-Frame-Options: DENY`, or the console cannot embed iframes.
 */
export function isExtensionGatewayUiAssetPath(path: string): boolean {
  return /^\/api\/extensions\/[^/]+\/assets\//.test(path);
}

export function createHonoApp(config: HonoAppConfig): Hono {
  if (process.env.VITEST) {
    resetLazyRouteBundlesForTests();
  }
  const { service, token } = config;
  const app = new Hono();

  const gatewayPort = resolveGatewayServiceListenPort(service);

  const resolveBrowserOrigins = (): string[] =>
    resolveAllowedBrowserOrigins({
      configuredOrigins: service.currentConfig.gateway.corsOrigins,
      port: gatewayPort,
      bindHost: resolveGatewayEffectiveHost(service.currentConfig),
      tunnelPublicUrl: loadTunnelState()?.publicUrl,
    });

  app.use(logContextMiddleware());
  app.use(logger({
    trustedProxies: service.currentConfig.gateway?.trustedProxies,
    allowRealIpFallback: service.currentConfig.gateway?.allowRealIpFallback === true,
  }));
  app.use(
    cors({
      origin: (origin) => {
        const allowed = resolveBrowserOrigins();
        if (!origin) {
          return allowed[0] ?? `http://127.0.0.1:${gatewayPort}`;
        }
        const normalized = origin.toLowerCase();
        const hit = allowed.find((entry) => entry.toLowerCase() === normalized);
        if (hit) return origin;
        return allowed.includes('*') ? '*' : '';
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Session-Id', 'Last-Event-ID'],
      credentials: true,
      maxAge: 86400,
    }),
  );

  // Build CSP header once at startup (no inline script hashes needed for SPA)
  const gatewayConsoleCsp = buildGatewayConsoleCspHeader();

  // Security headers middleware
  app.use(createMiddleware(async (c, next) => {
    await next();
    if (isExtensionGatewayUiAssetPath(c.req.path)) {
      return;
    }
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-XSS-Protection', '1; mode=block');
    // microphone=(self): allow same-origin chat voice (composer). microphone=() breaks packaged Electron loading the gateway SPA.
    c.header('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    c.header('Content-Security-Policy', gatewayConsoleCsp);
  }));

  // Browser Origin check middleware for API routes (CSRF protection).
  // Non-browser requests (no Origin header) pass through — they are
  // authenticated by the token middleware instead.
  const allowHostHeaderOriginFallback =
    service.currentConfig.gateway?.dangerouslyAllowHostHeaderOriginFallback === true;
  app.use('/api/*', createMiddleware(async (c, next) => {
    // Sandboxed extension iframes (no allow-same-origin) send `Origin: null`.
    // `checkBrowserOrigin` rejects that; these routes rely on CSP instead
    // (`registerPublicExtensionAssetRoutes`).
    if (isExtensionGatewayUiAssetPath(c.req.path)) {
      return next();
    }

    const origin = c.req.header('origin');
    if (!origin || origin.trim().toLowerCase() === 'null') {
      // Native apps / opaque origins — authenticated via Bearer token
      return next();
    }

    const result = checkBrowserOrigin({
      requestHost: c.req.header('host'),
      origin,
      allowedOrigins: resolveBrowserOrigins(),
      allowHostHeaderOriginFallback,
      isLocalClient: false,
    });

    if (!result.ok) {
      log.warn(
        {
          origin,
          requestHost: c.req.header('host'),
          reason: 'reason' in result ? result.reason : 'unknown',
          path: c.req.path,
          method: c.req.method,
        },
        `Browser origin check failed: ${origin} not in allowed list`,
      );
      return c.json({ error: 'Forbidden', message: 'Origin not allowed' }, 403);
    }

    return next();
  }));

  app.use('/api/skills/upload', bodyLimit({
    maxSize: 10 * 1024 * 1024,
    onError: (c) => {
      log.warn({ path: c.req.path, maxSizeMb: 10 }, 'Request body too large: skills upload exceeds 10MB limit');
      return c.json({ error: 'Skill package too large', maxSize: '10MB' }, 413);
    },
  }));

  const DEFAULT_API_BODY_MAX = 1 * 1024 * 1024;
  const WEBCHAT_AGENT_BODY_MAX = maxWebchatAgentRequestBodyBytes();

  app.use('/api/*', async (c, next) => {
    const maxSize = c.req.path === '/api/agent' ? WEBCHAT_AGENT_BODY_MAX : DEFAULT_API_BODY_MAX;
    const maxSizeMb = Math.ceil(maxSize / (1024 * 1024));
    return bodyLimit({
      maxSize,
      onError: (ctx) => {
        log.warn({ path: ctx.req.path, maxSizeMb }, `Request body too large: exceeds ${maxSizeMb}MB limit`);
        return ctx.json({ error: 'Request body too large', maxSize: `${maxSizeMb}MB` }, 413);
      },
    })(c, next);
  });

  registerPublicGatewayRoutes(app, service);

  // Extension UI assets are served without auth: sandboxed iframes (no allow-same-origin)
  // have an opaque origin of `null` and cannot forward the ?token= from the parent HTML URL.
  // Security is enforced by the strict CSP (frame-ancestors 'self') on every response.
  registerPublicExtensionAssetRoutes(app, service);

  const authenticated = new Hono();
  authenticated.use(
    auth({
      token,
      getGatewayAuth: () => service.currentConfig.gateway?.auth,
      getResolvedAuth: () => {
        if (typeof service.getResolvedAuth === 'function') {
          return service.getResolvedAuth();
        }
        return token ? { mode: 'token', token } : { mode: 'none' };
      },
      getTrustedProxyContext: () => ({
        trustedProxies: service.currentConfig.gateway?.trustedProxies,
        allowRealIpFallback: service.currentConfig.gateway?.allowRealIpFallback === true,
      }),
    }),
  );
  authenticated.use(operatorScopes());

  const strictRateLimitMiddleware = createStrictRateLimitMiddleware({
    getTrustedProxyContext: () => ({
      trustedProxies: service.currentConfig.gateway?.trustedProxies,
      allowRealIpFallback: service.currentConfig.gateway?.allowRealIpFallback === true,
    }),
  });

  const sseConfig = {
    service,
    maxSseConnections: service.currentConfig.gateway.maxSseConnections,
  };

  registerAuthenticatedRoutes(app, authenticated, {
    service,
    strictRateLimitMiddleware,
    sseConfig,
  });

  const prewarm = prewarmStaticUiCache();
  if (prewarm.loaded > 0) {
    log.debug({ loaded: prewarm.loaded, missing: prewarm.missing }, 'Static UI cache prewarmed');
  }

  app.route('/', authenticated);

  app.notFound((c) => {
    const isApiRoute = c.req.path.startsWith('/api/');
    const fields = { path: c.req.path, method: c.req.method };
    if (isApiRoute) {
      log.warn(fields, 'Route not found');
    } else {
      log.debug(fields, 'Route not found');
    }
    return c.json({ error: 'Not found' }, 404);
  });

  app.onError((err, c) => {
    log.error(
      {
        err,
        path: c.req.path,
        method: c.req.method,
        userAgent: c.req.header('user-agent'),
      },
      `Hono error on ${c.req.method} ${c.req.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
