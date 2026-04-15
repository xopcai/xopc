import type { Hono } from 'hono';

import type { GatewayService } from '../../service.js';
import { serveStaticFile } from '../lib/static-ui.js';

export function registerPublicGatewayRoutes(app: Hono, service: GatewayService): void {
  app.get('/health', (c) => {
    return c.json(service.getHealth());
  });

  app.get('/api', (c) => {
    return c.json({
      service: 'xopc-gateway',
      version: '0.1.0',
      transport: 'streamable-http',
      endpoints: [
        'GET  /health',
        'GET  /status',
        'POST /api/agent           (SSE stream / JSON)',
        'POST /api/agent/abort',
        'POST /api/agent/steer',
        'POST /api/send',
        'GET  /api/events          (SSE stream)',
        'GET  /api/channels/status',
        'POST /api/channels/weixin/login/start',
        'GET  /api/channels/weixin/login/:sessionKey',
        'GET  /api/config',
        'GET  /api/agents',
        'POST /api/agents',
        'PATCH /api/agents/:id',
        'DELETE /api/agents/:id',
        'GET/PUT /api/agents/:id/files/...',
        'PATCH /api/config',
        'POST /api/config/reload',
        'POST /api/heartbeat/trigger',
        '...  /api/cron/*',
        'GET/PATCH /api/sessions/:key/agent-config',
        '...  /api/sessions/*',
      ],
    });
  });

  app.get('/assets/*', (c) => {
    const path = c.req.path.replace('/assets/', '');
    const response = serveStaticFile(`assets/${path}`);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/favicon.ico', (c) => {
    const response = serveStaticFile('favicon.ico');
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/', (c) => {
    const response = serveStaticFile('index.html');
    if (response) return response;
    return c.text('UI not found', 404);
  });
}
