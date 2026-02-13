import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './middleware/logger.js';
import { auth } from './middleware/auth.js';
import type { GatewayService } from '../service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('HonoApp');

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
