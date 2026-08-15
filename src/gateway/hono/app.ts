import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';

import { resolveGatewayEffectiveHost } from '../../config/gateway-bind.js';
import { createLogger } from '../../utils/logger.js';
import type { GatewayService } from '../service.js';
import { resolveAllowedBrowserOrigins, resolveGatewayServiceListenPort } from '../host.js';
import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import { WORK_ITEM_ATTACHMENT_UPLOAD_BODY_MAX_BYTES } from '../../work-items/index.js';
import { maxWebchatAgentRequestBodyBytes } from '../chat-limits.js';
import { buildGatewayConsoleCspHeader } from '../security/csp.js';
import { checkBrowserOrigin } from '../security/origin-check.js';
import { isLoopbackIpAddress, isTrustedProxyAddress } from '../client-ip.js';
import { resolveReverseProxyPublicUrl } from '../public-url.js';
import { auth } from './middleware/auth.js';
import { operatorScopes } from './middleware/scopes.js';
import {
  createChannelRateLimitMiddleware,
  createStrictRateLimitMiddleware,
  createXopcCloudPollRateLimitMiddleware,
} from './middleware/strict-rate-limit.js';
import { logContextMiddleware } from './middleware/log-context.js';
import { logger } from './middleware/logger.js';
import { routeErrorMiddleware } from './middleware/route-errors.js';
import { registerPublicExtensionAssetRoutes } from './routes/auth-registry-extensions.js';
import { registerAuthenticatedRoutes } from './routes/index.js';
import { registerPublicGatewayRoutes } from './routes/public-gateway.js';
import { registerPublicLocalAppPreviewRoutes } from './routes/local-apps.js';
import { resetLazyRouteBundlesForTests } from './routes/lazy-fallback.js';
import { prewarmStaticUiCache } from './lib/static-ui.js';
import { registerSiteShareMiddleware } from '../../share/site-share-router.js';
const log = createLogger('Gateway:App');

export interface HonoAppConfig {
  service: GatewayService;
}

/**
 * Extension sandbox HTML under `/api/extensions/:id/assets/*` ships its own CSP
 * (`frame-ancestors 'self'`). The global gateway middleware must not overwrite it
 * with `frame-ancestors 'none'` / `X-Frame-Options: DENY`, or the console cannot embed iframes.
 */
export function isExtensionGatewayUiAssetPath(path: string): boolean {
  return /^\/api\/extensions\/[^/]+\/assets\//.test(path)
    || /^\/api\/local-apps\/preview\/[^/]+\//.test(path);
}

export function createHonoApp(config: HonoAppConfig): Hono {
  if (process.env.VITEST) {
    resetLazyRouteBundlesForTests();
  }
  const { service } = config;
  const app = new Hono();

  const gatewayPort = resolveGatewayServiceListenPort(service);

  const resolveBrowserOrigins = (): string[] =>
    resolveAllowedBrowserOrigins({
      configuredOrigins: service.currentConfig.gateway.corsOrigins,
      port: gatewayPort,
      bindHost: resolveGatewayEffectiveHost(service.currentConfig),
      tunnelPublicUrl: loadTunnelState()?.publicUrl,
      reverseProxyPublicUrl: resolveReverseProxyPublicUrl(service.currentConfig),
    });

  /**
   * TCP source for the in-flight request, normalized for trusted-proxy checks.
   * Returns undefined when the runtime doesn't expose conninfo (tests, mocks).
   */
  const resolveRequestRemoteAddress = (c: Context): string | undefined => {
    try {
      return getConnInfo(c).remote.address;
    } catch {
      return undefined;
    }
  };

  /**
   * A request's TCP source qualifies as a "trusted proxy hop" when it's
   * loopback (the user's own machine, where any reverse proxy lives) or
   * listed in `gateway.trustedProxies`. We use this signal to safely
   * auto-allow same-host Origins through CSRF without requiring a manual
   * `corsOrigins` entry for every reverse-proxy hostname.
   */
  const isRequestFromTrustedProxy = (c: Context): boolean => {
    const remote = resolveRequestRemoteAddress(c);
    if (!remote) return false;
    if (isLoopbackIpAddress(remote)) return true;
    return isTrustedProxyAddress(remote, service.currentConfig.gateway?.trustedProxies);
  };

  app.use(logContextMiddleware());
  app.use(logger({
    trustedProxies: service.currentConfig.gateway?.trustedProxies,
    allowRealIpFallback: service.currentConfig.gateway?.allowRealIpFallback === true,
  }));

  // Site-share middleware runs BEFORE CORS/CSP — it owns the request when the
  // Host header matches `*.<publicHostSuffix>` (default `*.share.xopc.ai`) or
  // the path starts with `/site/:token/`. Otherwise it falls through.
  registerSiteShareMiddleware(app, service);
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
      autoAllowSameHostFromTrustedProxy: isRequestFromTrustedProxy(c),
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

  const DEFAULT_API_BODY_MAX = 1 * 1024 * 1024;
  const SKILL_UPLOAD_BODY_MAX = 10 * 1024 * 1024;
  const NOTE_MEDIA_BODY_MAX = 25 * 1024 * 1024;
  const VOICE_TRANSCRIBE_BODY_MAX = 35 * 1024 * 1024;
  const WEBCHAT_AGENT_BODY_MAX = maxWebchatAgentRequestBodyBytes();

  const isNoteMediaUploadRequest = (path: string, method: string, contentType: string | undefined): boolean => {
    if (method !== 'POST') return false;
    if (/^\/api\/notes\/[^/]+\/media$/.test(path)) return true;
    return path === '/api/notes' && contentType?.includes('multipart/form-data') === true;
  };

  const discussionUploadBodyMax = (
    path: string,
    method: string,
    contentType: string | undefined,
  ): number | undefined => {
    if (method !== 'PUT' || contentType?.includes('multipart/form-data') !== true) return undefined;
    if (/^\/api\/discussions\/[^/]+\/recording$/.test(path)) return NOTE_MEDIA_BODY_MAX;
    if (/^\/api\/discussions\/[^/]+\/segments\/\d+$/.test(path)) return 2 * 1024 * 1024;
    return undefined;
  };

  const isWorkItemAttachmentUploadRequest = (path: string, method: string, contentType: string | undefined): boolean => {
    if (method !== 'POST' || contentType?.includes('multipart/form-data') !== true) return false;
    return /^\/api\/work-items\/[^/]+\/attachments$/.test(path)
      || /^\/api\/projects\/[^/]+\/work-items$/.test(path);
  };

  app.use('/api/skills/upload', bodyLimit({
    maxSize: SKILL_UPLOAD_BODY_MAX,
    onError: (c) => {
      log.warn({ path: c.req.path, maxSizeMb: 10 }, 'Request body too large: skills upload exceeds 10MB limit');
      return c.json({ error: 'Skill package too large', maxSize: '10MB' }, 413);
    },
  }));

  app.use('/api/*', async (c, next) => {
    const contentType = c.req.header('content-type');
    const maxSize = c.req.path === '/api/agent'
      ? WEBCHAT_AGENT_BODY_MAX
      : c.req.path === '/api/skills/upload'
        ? SKILL_UPLOAD_BODY_MAX
        : c.req.path === '/api/voice/transcribe' || c.req.path === '/api/voice/transcriptions'
          ? VOICE_TRANSCRIBE_BODY_MAX
          : isNoteMediaUploadRequest(c.req.path, c.req.method, contentType)
            ? NOTE_MEDIA_BODY_MAX
            : discussionUploadBodyMax(c.req.path, c.req.method, contentType)
              ?? (isWorkItemAttachmentUploadRequest(c.req.path, c.req.method, contentType)
                ? WORK_ITEM_ATTACHMENT_UPLOAD_BODY_MAX_BYTES
                : DEFAULT_API_BODY_MAX);
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
  registerPublicLocalAppPreviewRoutes(app, service);

  const authenticated = new Hono();
  authenticated.use(routeErrorMiddleware());
  authenticated.use(
    auth({
      getGatewayAuth: () => service.currentConfig.gateway?.auth,
      getResolvedAuth: () => service.getResolvedAuth(),
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
  const channelRateLimitMiddleware = createChannelRateLimitMiddleware({
    getTrustedProxyContext: () => ({
      trustedProxies: service.currentConfig.gateway?.trustedProxies,
      allowRealIpFallback: service.currentConfig.gateway?.allowRealIpFallback === true,
    }),
  });
  const xopcCloudPollRateLimitMiddleware = createXopcCloudPollRateLimitMiddleware({
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
    xopcCloudPollRateLimitMiddleware,
    channelRateLimitMiddleware,
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
        phase: 'gateway.http.unhandled',
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
