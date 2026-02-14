import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './middleware/logger.js';
import { auth } from './middleware/auth.js';
import { createAgentSSEHandler, createSendHandler, createEventsSSEHandler } from './sse.js';
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

  // CORS configuration from config
  const corsOrigins = service.currentConfig.gateway.corsOrigins || ['*'];
  const isProduction = process.env.NODE_ENV === 'production';
  const effectiveOrigins = isProduction && corsOrigins.length > 0 ? corsOrigins : ['*'];

  const CORS_OPTIONS = {
    origin: effectiveOrigins,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Session-Id', 'Last-Event-ID'],
    credentials: true,
    maxAge: 86400,
  };

  // Global middleware
  app.use(logger());
  app.use(cors(CORS_OPTIONS));

  // Health endpoint (no auth required)
  app.get('/health', (c) => {
    return c.json(service.getHealth());
  });

  // API info (no auth required for basic info)
  app.get('/', (c) => {
    return c.json({
      service: 'xopcbot-gateway',
      version: '0.1.0',
      transport: 'streamable-http',
      endpoints: [
        'GET  /health',
        'GET  /status',
        'POST /api/agent           (SSE stream / JSON)',
        'POST /api/send',
        'GET  /api/events          (SSE stream)',
        'GET  /api/channels/status',
        'POST /api/config/reload',
        'GET  /api/config',
        '...  /api/cron/*',
        '...  /api/sessions/*',
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

  // ========== Core SSE API ==========

  const sseConfig = { 
    service,
    maxSseConnections: service.currentConfig.gateway.maxSseConnections,
  };

  // POST /api/agent — Agent message (SSE stream or JSON fallback)
  authenticated.post('/api/agent', createAgentSSEHandler(sseConfig));

  // POST /api/send — Send a message through a channel
  authenticated.post('/api/send', createSendHandler(sseConfig));

  // GET /api/events — Server-pushed event stream
  authenticated.get('/api/events', createEventsSSEHandler(sseConfig));

  // GET /api/channels/status
  authenticated.get('/api/channels/status', (c) => {
    const channels = service.getChannelsStatus();
    return c.json({ ok: true, payload: { channels } });
  });

  // POST /api/config/reload
  authenticated.post('/api/config/reload', async (c) => {
    const result = await service.reloadConfig();
    return c.json({ ok: true, payload: result });
  });

  // GET /api/config
  authenticated.get('/api/config', (c) => {
    const config = service.currentConfig;
    const safeConfig = {
      agents: config.agents,
      channels: {
        telegram: { enabled: config.channels?.telegram?.enabled },
        whatsapp: { enabled: config.channels?.whatsapp?.enabled },
      },
      gateway: config.gateway,
      cron: { enabled: config.cron?.enabled },
    };
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  // ========== Cron REST API ==========
  
  // GET /cron - List all jobs
  authenticated.get('/cron', async (c) => {
    const jobs = await service.cronServiceInstance.listJobs();
    return c.json({ jobs });
  });

  // GET /cron/:id - Get single job
  authenticated.get('/cron/:id', async (c) => {
    const id = c.req.param('id');
    const job = await service.cronServiceInstance.getJob(id);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }
    return c.json({ job });
  });

  // POST /cron - Add new job
  authenticated.post('/cron', async (c) => {
    const body = await c.req.json();
    const { schedule, message, name, timezone } = body;
    
    if (!schedule || !message) {
      return c.json({ error: 'Missing required fields: schedule, message' }, 400);
    }

    try {
      const result = await service.cronServiceInstance.addJob(schedule, message, { name, timezone });
      return c.json(result, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to add job' }, 400);
    }
  });

  // PATCH /cron/:id - Update job
  authenticated.patch('/cron/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    try {
      const result = await service.cronServiceInstance.updateJob(id, body);
      return c.json({ updated: result });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update job' }, 400);
    }
  });

  // DELETE /cron/:id - Remove job
  authenticated.delete('/cron/:id', async (c) => {
    const id = c.req.param('id');
    const result = await service.cronServiceInstance.removeJob(id);
    return c.json({ removed: result });
  });

  // POST /cron/:id/toggle - Toggle job enabled
  authenticated.post('/cron/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { enabled } = body;
    
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'Missing required field: enabled' }, 400);
    }

    const result = await service.cronServiceInstance.toggleJob(id, enabled);
    return c.json({ toggled: result });
  });

  // POST /cron/:id/run - Trigger job manually
  authenticated.post('/cron/:id/run', async (c) => {
    const id = c.req.param('id');
    
    try {
      await service.cronServiceInstance.runJobNow(id);
      return c.json({ triggered: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to run job' }, 400);
    }
  });

  // GET /cron/:id/history - Get job execution history
  authenticated.get('/cron/:id/history', async (c) => {
    const id = c.req.param('id');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;
    const history = service.cronServiceInstance.getJobHistory(id, limit);
    return c.json({ history });
  });

  // GET /cron/metrics - Get cron metrics
  authenticated.get('/cron/metrics', async (c) => {
    const metrics = await service.cronServiceInstance.getMetrics();
    return c.json(metrics);
  });

  // ========== Session REST API ==========
  
  // POST /sessions - Create new session
  authenticated.post('/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel || 'gateway';
    const chatId = body.chat_id || `chat_${Date.now()}`;
    const sessionKey = `${channel}:${chatId}`;
    
    // Initialize empty session
    await service.sessionManagerInstance.saveMessages(sessionKey, []);
    
    const session = await service.getSession(sessionKey);
    return c.json({ session }, 201);
  });

  // GET /sessions - List sessions
  authenticated.get('/sessions', async (c) => {
    const query = c.req.query();
    const result = await service.listSessions({
      status: query.status as any,
      search: query.search,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /sessions/:key - Get single session
  authenticated.get('/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ session });
  });

  // DELETE /sessions/:key - Delete session
  authenticated.delete('/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const result = await service.deleteSession(key);
    return c.json(result);
  });

  // POST /sessions/:key/archive - Archive session
  authenticated.post('/sessions/:key/archive', async (c) => {
    const key = c.req.param('key');
    const result = await service.archiveSession(key);
    return c.json(result);
  });

  // POST /sessions/:key/unarchive - Unarchive session
  authenticated.post('/sessions/:key/unarchive', async (c) => {
    const key = c.req.param('key');
    const result = await service.unarchiveSession(key);
    return c.json(result);
  });

  // POST /sessions/:key/pin - Pin session
  authenticated.post('/sessions/:key/pin', async (c) => {
    const key = c.req.param('key');
    const result = await service.pinSession(key);
    return c.json(result);
  });

  // POST /sessions/:key/unpin - Unpin session
  authenticated.post('/sessions/:key/unpin', async (c) => {
    const key = c.req.param('key');
    const result = await service.unpinSession(key);
    return c.json(result);
  });

  // POST /sessions/:key/rename - Rename session
  authenticated.post('/sessions/:key/rename', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json();
    const { name } = body;
    const result = await service.renameSession(key, name);
    return c.json(result);
  });

  // GET /sessions/:key/export - Export session
  authenticated.get('/sessions/:key/export', async (c) => {
    const key = c.req.param('key');
    const format = c.req.query('format') as any || 'json';
    const result = await service.exportSession(key, format);
    return c.json(result);
  });

  // GET /sessions/stats - Get session stats
  authenticated.get('/sessions/stats', async (c) => {
    const result = await service.getSessionStats();
    return c.json(result);
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
