import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './middleware/logger.js';
import { auth } from './middleware/auth.js';
import type { GatewayService } from '../service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('HonoApp');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UI_STATIC_ROOT = join(__dirname, '../../gateway/static/root');

// MIME type mapping for static assets
const MIME_TYPES: Record<string, string> = {
  js: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
};

// Serve a static file from UI static root
function serveStaticFile(relativePath: string): Response | null {
  const filePath = `${UI_STATIC_ROOT}/${relativePath}`;
  try {
    const content = readFileSync(filePath);
    const ext = relativePath.split('.').pop() || '';
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return null;
  }
}

export interface HonoAppConfig {
  service: GatewayService;
  token?: string;
}

export function createHonoApp(config: HonoAppConfig): Hono {
  const { service, token } = config;
  const app = new Hono();

  // Global middleware
  app.use(logger());
  app.use(cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  // Health endpoint (no auth required)
  app.get('/health', (c) => {
    return c.json(service.getHealth());
  });

  // API info (no auth required for basic info)
  app.get('/', (c) => {
    return c.json({
      service: 'xopcbot-gateway',
      version: '0.1.0',
      endpoints: [
        'GET /health',
        'WS / (WebSocket protocol)',
      ],
      methods: [
        'health', 'status', 'agent', 'send',
        'channels.status', 'config.reload', 'config.get',
        'cron.list', 'cron.add', 'cron.remove', 'cron.toggle', 'cron.metrics',
      ],
    });
  });

  // Authenticated routes
  const authenticated = new Hono();
  authenticated.use(auth({ token }));

  // Protected status endpoint
  authenticated.get('/status', (c) => {
    const health = service.getHealth();
    return c.json({
      status: health.status,
      version: health.version,
      channels: health.channels,
      uptime: health.uptime,
    });
  });

  // Mount authenticated routes
  app.route('/', authenticated);

  // UI static files
  app.get('/ui', (c) => c.redirect('/ui/'));

  app.get('/ui/', (c) => {
    const response = serveStaticFile('index.html');
    if (response) return response;
    return c.text('UI not found', 404);
  });

  app.get('/ui/assets/*', (c) => {
    const path = c.req.path.replace('/ui/assets/', '');
    const response = serveStaticFile(`assets/${path}`);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/assets/*', (c) => {
    const path = c.req.path.replace('/assets/', '');
    const response = serveStaticFile(`assets/${path}`);
    if (response) return response;
    return c.text('Not found', 404);
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    log.error({ err }, 'Hono error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
