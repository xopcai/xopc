import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';

import { createFixedWindowRateLimiter } from '../../infra/rate-limit.js';
import { createLogger } from '../../utils/logger.js';
import type { GatewayService } from '../service.js';
import { maxWebchatAgentRequestBodyBytes } from '../chat-limits.js';
import { auth } from './middleware/auth.js';
import { logContextMiddleware } from './middleware/log-context.js';
import { logger } from './middleware/logger.js';
import { registerPublicExtensionAssetRoutes } from './routes/auth-registry-extensions.js';
import { registerAuthenticatedRoutes } from './routes/index.js';
import { registerPublicGatewayRoutes } from './routes/public-gateway.js';

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
  const { service, token } = config;
  const app = new Hono();

  const gatewayPort = service.currentConfig.gateway.port ?? 18790;
  const configuredOrigins = service.currentConfig.gateway.corsOrigins;

  let corsOrigin: string | string[];
  if (configuredOrigins && configuredOrigins.length > 0) {
    corsOrigin = configuredOrigins;
  } else {
    corsOrigin = [
      `http://localhost:${gatewayPort}`,
      `http://127.0.0.1:${gatewayPort}`,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
  }

  const CORS_OPTIONS = {
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Session-Id', 'Last-Event-ID'],
    credentials: true,
    maxAge: 86400,
  };

  app.use(logContextMiddleware());
  app.use(logger());
  app.use(cors(CORS_OPTIONS));

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
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  }));

  app.use('/api/skills/upload', bodyLimit({
    maxSize: 10 * 1024 * 1024,
    onError: (c) => {
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
      onError: (ctx) =>
        ctx.json({ error: 'Request body too large', maxSize: `${maxSizeMb}MB` }, 413),
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
    }),
  );

  const strictRateLimiter = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();

  const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000;
  setInterval(() => {
    for (const [ip, limiter] of strictRateLimiter.entries()) {
      const result = limiter.consume();
      if (result.remaining === 9) {
        strictRateLimiter.delete(ip);
      }
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL);

  const strictRateLimitMiddleware = createMiddleware(async (c, next) => {
    /*
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';

    let limiter = strictRateLimiter.get(clientIp);
    if (!limiter) {
      limiter = createFixedWindowRateLimiter({ maxRequests: 10, windowMs: 60_000 });
      strictRateLimiter.set(clientIp, limiter);
    }

    const result = limiter.consume();
    if (!result.allowed) {
      c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }

    c.header('X-RateLimit-Remaining', String(result.remaining));
    */
    await next();
  });

  const sseConfig = {
    service,
    maxSseConnections: service.currentConfig.gateway.maxSseConnections,
  };

  registerAuthenticatedRoutes(authenticated, {
    service,
    strictRateLimitMiddleware,
    sseConfig,
  });

  app.route('/', authenticated);

  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  app.onError((err, c) => {
    log.error({ err }, 'Hono error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
