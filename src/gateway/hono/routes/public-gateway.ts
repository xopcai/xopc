import type { Hono } from 'hono';

import { PACKAGE_VERSION } from '../../../package-version.js';
import type { GatewayService } from '../../service.js';
import { serveStaticFile } from '../lib/static-ui.js';

export function registerPublicGatewayRoutes(app: Hono, service: GatewayService): void {
  app.get('/health', (c) => {
    return c.json(service.getHealth());
  });

  /** Public liveness probe (no auth) — minimal payload for CLI / load balancers. */
  app.get('/api/health', (c) => {
    const health = service.getHealth();
    return c.json({
      status: health.ready ? 'ok' : 'starting',
      ready: health.ready,
      httpListening: health.httpListening,
      version: health.version,
      uptime: health.uptime,
      startupDurationMs: health.startupDurationMs,
    });
  });

  app.get('/api', (c) => {
    return c.json({
      service: 'xopc-gateway',
      version: PACKAGE_VERSION,
      transport: 'streamable-http',
      endpoints: [
        'GET  /health',
        'GET  /api/health',
        'GET  /status',
        'GET  /api/status',
        'POST /api/agent           (SSE stream / JSON)',
        'POST /api/agent/abort',
        'POST /api/agent/steer',
        'POST /api/send',
        'GET  /api/events          (SSE stream)',
        'GET  /api/channels/catalog',
        'GET  /api/channels/status',
        'POST /api/channels/:channelId/actions/:actionId',
        'GET  /api/config',
        'GET  /api/agents',
        'POST /api/agents',
        'PATCH /api/agents/:id',
        'DELETE /api/agents/:id',
        'GET/PUT/DELETE /api/agents/:id/avatar',
        'GET/PUT /api/agents/:id/files/...',
        'DELETE /api/providers/:providerId/key',
        'PATCH /api/config',
        'POST /api/config/reload',
        'POST /api/heartbeat/trigger',
        '...  /api/cron/*',
        'GET/PATCH /api/sessions/:key/agent-config',
        '...  /api/sessions/*',
        'GET  /api/host/fs/meta',
        'GET  /api/host/fs/list',
      ],
    });
  });

  app.get('/assets/*', (c) => {
    const path = c.req.path.replace('/assets/', '');
    const response = serveStaticFile(`assets/${path}`, c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  /** From `web/public/channel-icons/` (Vite copies to static root). Public: img requests send no Bearer token. */
  app.get('/channel-icons/*', (c) => {
    const path = c.req.path.replace('/channel-icons/', '');
    const response = serveStaticFile(`channel-icons/${path}`, c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/favicon.ico', (c) => {
    const response = serveStaticFile('favicon.ico', c.req.raw);
    if (response) return response;
    const fallback = serveStaticFile('logo.svg', c.req.raw);
    if (fallback) return fallback;
    return c.text('Not found', 404);
  });

  app.get('/logo.svg', (c) => {
    const response = serveStaticFile('logo.svg', c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/logo-dark.svg', (c) => {
    const response = serveStaticFile('logo-dark.svg', c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/', (c) => {
    const response = serveStaticFile('index.html', c.req.raw);
    if (response) return response;
    return c.text('UI not found', 404);
  });
}
