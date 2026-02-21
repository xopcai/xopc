import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './middleware/logger.js';
import { auth } from './middleware/auth.js';
import { createAgentSSEHandler, createSendHandler, createEventsSSEHandler } from './sse.js';
import type { GatewayService } from '../service.js';
import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { queryLogs, getLogFiles, getLogLevels, getLogStats, getLogModules, LOG_DIR } from '../../utils/log-store.js';
import type { LogLevel } from '../../utils/logger.types.js';
import { getLocalModelsDevModels } from '../../providers/models-dev.js';
import { isProviderConfigured } from '../../agent/fallback/index.js';

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

  // CORS configuration
  // Development: allow all origins by default
  // Production: use config, default to denying all if not configured
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredOrigins = service.currentConfig.gateway.corsOrigins;
  
  let corsOrigin: string | string[];
  if (isProduction) {
    // Production: use configured origins, or '*' if explicitly allowed
    corsOrigin = configuredOrigins && configuredOrigins.length > 0 ? configuredOrigins : '*';
  } else {
    // Development: allow all origins by default
    corsOrigin = '*';
  }

  const CORS_OPTIONS = {
    origin: corsOrigin,
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

  // Root path - serve UI
  app.get('/', (c) => {
    const response = serveStaticFile('index.html');
    if (response) return response;
    return c.text('UI not found', 404);
  });

  // API info (no auth required for basic info)
  app.get('/api', (c) => {
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
        'GET  /api/config',
        'PATCH /api/config',
        'POST /api/config/reload',
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
      agents: {
        defaults: {
          model: config.agents?.defaults?.model,
          maxTokens: config.agents?.defaults?.maxTokens,
          temperature: config.agents?.defaults?.temperature,
          maxToolIterations: config.agents?.defaults?.maxToolIterations,
          workspace: config.agents?.defaults?.workspace,
          compaction: config.agents?.defaults?.compaction,
          pruning: config.agents?.defaults?.pruning,
        },
      },
      channels: {
        telegram: {
          enabled: config.channels?.telegram?.enabled,
          token: config.channels?.telegram?.token || '',
          allowFrom: config.channels?.telegram?.allowFrom || [],
          apiRoot: config.channels?.telegram?.apiRoot || '',
          debug: config.channels?.telegram?.debug || false,
        },
        whatsapp: {
          enabled: config.channels?.whatsapp?.enabled,
          bridgeUrl: config.channels?.whatsapp?.bridgeUrl || 'ws://localhost:3001',
          allowFrom: config.channels?.whatsapp?.allowFrom || [],
        },
      },
      providers: {
        openai: { apiKey: config.providers?.openai?.apiKey || '', baseUrl: config.providers?.openai?.baseUrl || '' },
        anthropic: { apiKey: config.providers?.anthropic?.apiKey || '' },
        google: { apiKey: config.providers?.google?.apiKey || '' },
        qwen: { apiKey: config.providers?.qwen?.apiKey || '', baseUrl: config.providers?.qwen?.baseUrl || '' },
        kimi: { apiKey: config.providers?.kimi?.apiKey || '', baseUrl: config.providers?.kimi?.baseUrl || '' },
        minimax: { apiKey: config.providers?.minimax?.apiKey || '', baseUrl: config.providers?.minimax?.baseUrl || '' },
        deepseek: { apiKey: config.providers?.deepseek?.apiKey || '', baseUrl: config.providers?.deepseek?.baseUrl || '' },
        groq: { apiKey: config.providers?.groq?.apiKey || '', baseUrl: config.providers?.groq?.baseUrl || '' },
        openrouter: { apiKey: config.providers?.openrouter?.apiKey || '', baseUrl: config.providers?.openrouter?.baseUrl || '' },
        ollama: { 
          enabled: config.providers?.ollama?.enabled ?? true, 
          baseUrl: config.providers?.ollama?.baseUrl || 'http://127.0.0.1:11434/v1',
          autoDiscovery: config.providers?.ollama?.autoDiscovery ?? true,
        },
      },
      gateway: {
        host: config.gateway?.host,
        port: config.gateway?.port,
        heartbeat: {
          enabled: config.gateway?.heartbeat?.enabled,
          intervalMs: config.gateway?.heartbeat?.intervalMs,
        },
      },
      cron: { enabled: config.cron?.enabled },
    };
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  // PATCH /api/config - Update partial config
  authenticated.patch('/api/config', async (c) => {
    const body = await c.req.json();
    
    // Merge updates into current config
    const config: Config = service.currentConfig as Config;
    
    // Update agent defaults
    if (body.agents?.defaults) {
      if (!config.agents) config.agents = { defaults: { workspace: '~/.xopcbot/workspace', model: 'anthropic/claude-sonnet-4-5', maxTokens: 8192, temperature: 0.7, maxToolIterations: 20 } };
      if (!config.agents.defaults) config.agents.defaults = {} as any;
      
      if (body.agents.defaults.model !== undefined) {
        config.agents.defaults.model = body.agents.defaults.model;
      }
      if (body.agents.defaults.maxTokens !== undefined) {
        config.agents.defaults.maxTokens = body.agents.defaults.maxTokens;
      }
      if (body.agents.defaults.temperature !== undefined) {
        config.agents.defaults.temperature = body.agents.defaults.temperature;
      }
      if (body.agents.defaults.maxToolIterations !== undefined) {
        config.agents.defaults.maxToolIterations = body.agents.defaults.maxToolIterations;
      }
      if (body.agents.defaults.workspace !== undefined) {
        config.agents.defaults.workspace = body.agents.defaults.workspace;
      }
    }
    
    // Update channels
    if (body.channels?.telegram) {
      if (!config.channels) config.channels = { telegram: { enabled: false, token: '', allowFrom: [], debug: false }, whatsapp: { enabled: false, bridgeUrl: 'ws://localhost:3001', allowFrom: [] } };
      if (!config.channels.telegram) config.channels.telegram = {} as any;
      
      if (body.channels.telegram.enabled !== undefined) {
        config.channels.telegram.enabled = body.channels.telegram.enabled;
      }
      if (body.channels.telegram.token !== undefined) {
        config.channels.telegram.token = body.channels.telegram.token;
      }
      if (body.channels.telegram.allowFrom !== undefined) {
        config.channels.telegram.allowFrom = body.channels.telegram.allowFrom;
      }
      if (body.channels.telegram.apiRoot !== undefined) {
        config.channels.telegram.apiRoot = body.channels.telegram.apiRoot;
      }
      if (body.channels.telegram.debug !== undefined) {
        config.channels.telegram.debug = body.channels.telegram.debug;
      }
    }
    if (body.channels?.whatsapp) {
      if (!config.channels) config.channels = { telegram: { enabled: false, token: '', allowFrom: [], debug: false }, whatsapp: { enabled: false, bridgeUrl: 'ws://localhost:3001', allowFrom: [] } };
      if (!config.channels.whatsapp) config.channels.whatsapp = {} as any;
      
      if (body.channels.whatsapp.enabled !== undefined) {
        config.channels.whatsapp.enabled = body.channels.whatsapp.enabled;
      }
      if (body.channels.whatsapp.bridgeUrl !== undefined) {
        config.channels.whatsapp.bridgeUrl = body.channels.whatsapp.bridgeUrl;
      }
      if (body.channels.whatsapp.allowFrom !== undefined) {
        config.channels.whatsapp.allowFrom = body.channels.whatsapp.allowFrom;
      }
    }
    
    // Update gateway
    if (body.gateway?.heartbeat?.enabled !== undefined) {
      if (!config.gateway) config.gateway = { host: '0.0.0.0', port: 18790, heartbeat: { enabled: true, intervalMs: 60000 }, maxSseConnections: 100, corsOrigins: ['*'] };
      if (!config.gateway.heartbeat) config.gateway.heartbeat = { enabled: true, intervalMs: 60000 };
      config.gateway.heartbeat.enabled = body.gateway.heartbeat.enabled;
    }
    if (body.gateway?.heartbeat?.intervalMs !== undefined) {
      if (!config.gateway) config.gateway = { host: '0.0.0.0', port: 18790, heartbeat: { enabled: true, intervalMs: 60000 }, maxSseConnections: 100, corsOrigins: ['*'] };
      if (!config.gateway.heartbeat) config.gateway.heartbeat = { enabled: true, intervalMs: 60000 };
      config.gateway.heartbeat.intervalMs = body.gateway.heartbeat.intervalMs;
    }
    
    // Update providers
    if (body.providers) {
      if (!config.providers) config.providers = {} as any;
      
      const providerKeys = ['openai', 'anthropic', 'google', 'qwen', 'kimi', 'minimax', 'deepseek', 'groq', 'openrouter', 'ollama', 'moonshot', 'xai', 'bedrock'];
      for (const key of providerKeys) {
        if (body.providers[key]) {
          if (!config.providers[key]) config.providers[key] = {} as any;
          
          if (body.providers[key].apiKey !== undefined) {
            config.providers[key].apiKey = body.providers[key].apiKey;
          }
          if (body.providers[key].baseUrl !== undefined) {
            config.providers[key].baseUrl = body.providers[key].baseUrl || undefined;
          }
          if (body.providers[key].enabled !== undefined) {
            config.providers[key].enabled = body.providers[key].enabled;
          }
          if (body.providers[key].autoDiscovery !== undefined) {
            config.providers[key].autoDiscovery = body.providers[key].autoDiscovery;
          }
        }
      }
    }
    
    // Save config
    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }
    
    return c.json({ ok: true, payload: { config } });
  });

  // GET /api/models - Get available models (only configured providers)
  authenticated.get('/api/models', (c) => {
    const config = service.currentConfig;
    const localModels = getLocalModelsDevModels();
    const models: Array<{ id: string; name: string; provider: string }> = [];

    for (const [provider, providerModels] of localModels) {
      // Only include models from configured providers (have API key or enabled)
      if (!isProviderConfigured(config, provider)) continue;

      for (const model of providerModels) {
        models.push({
          id: `${provider}/${model.id}`,
          name: model.name || model.id,
          provider: provider,
        });
      }
    }

    // Sort by provider then name
    models.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    return c.json({ ok: true, payload: { models } });
  });

  // ========== Cron REST API (/api/cron) ==========

  // GET /api/cron - List all jobs
  authenticated.get('/api/cron', async (c) => {
    const jobs = await service.cronServiceInstance.listJobs();
    return c.json({ jobs });
  });

  // POST /api/cron - Add new job
  authenticated.post('/api/cron', async (c) => {
    const body = await c.req.json();
    const { schedule, message, name, timezone, sessionTarget, model, delivery } = body;

    if (!schedule || !message) {
      return c.json({ error: 'Missing required fields: schedule, message' }, 400);
    }

    try {
      const result = await service.cronServiceInstance.addJob(schedule, message, { 
        name, 
        timezone,
        sessionTarget,
        model,
        delivery,
      });
      return c.json(result, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to add job' }, 400);
    }
  });

  // GET /api/cron/metrics - Get cron metrics (must be before /:id)
  authenticated.get('/api/cron/metrics', async (c) => {
    const metrics = await service.cronServiceInstance.getMetrics();
    return c.json(metrics);
  });

  // GET /api/cron/:id - Get single job (must be after /metrics)
  authenticated.get('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const job = await service.cronServiceInstance.getJob(id);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }
    return c.json({ job });
  });

  // POST /api/cron/:id/toggle - Toggle job enabled
  authenticated.post('/api/cron/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'Missing required field: enabled' }, 400);
    }

    const result = await service.cronServiceInstance.toggleJob(id, enabled);
    return c.json({ toggled: result });
  });

  // POST /api/cron/:id/run - Trigger job manually
  authenticated.post('/api/cron/:id/run', async (c) => {
    const id = c.req.param('id');

    try {
      await service.cronServiceInstance.runJobNow(id);
      return c.json({ triggered: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to run job' }, 400);
    }
  });

  // GET /api/cron/:id/history - Get job execution history
  authenticated.get('/api/cron/:id/history', async (c) => {
    const id = c.req.param('id');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;
    const history = service.cronServiceInstance.getJobHistory(id, limit);
    return c.json({ history });
  });

  // PATCH /api/cron/:id - Update job
  authenticated.patch('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();

    try {
      const result = await service.cronServiceInstance.updateJob(id, body);
      return c.json({ updated: result });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update job' }, 400);
    }
  });

  // DELETE /api/cron/:id - Remove job
  authenticated.delete('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const result = await service.cronServiceInstance.removeJob(id);
    return c.json({ removed: result });
  });

  // ========== Session REST API (/api/sessions) ==========

  // POST /api/sessions - Create new session
  authenticated.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel || 'gateway';
    const chatId = body.chat_id || `chat_${Date.now()}`;
    const sessionKey = `${channel}:${chatId}`;

    await service.sessionManagerInstance.saveMessages(sessionKey, []);

    const session = await service.getSession(sessionKey);
    return c.json({ session }, 201);
  });

  // GET /api/sessions - List sessions
  authenticated.get('/api/sessions', async (c) => {
    const query = c.req.query();
    const result = await service.listSessions({
      status: query.status as any,
      search: query.search,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/sessions/stats - Get session stats (must be before /:key)
  authenticated.get('/api/sessions/stats', async (c) => {
    const result = await service.getSessionStats();
    return c.json(result);
  });

  // GET /api/sessions/:key - Get single session (must be after /stats)
  authenticated.get('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ session });
  });

  // GET /api/sessions/:key/export - Export session (must be before /:key)
  authenticated.get('/api/sessions/:key/export', async (c) => {
    const key = c.req.param('key');
    const format = c.req.query('format') as any || 'json';
    const result = await service.exportSession(key, format);
    return c.json(result);
  });

  // DELETE /api/sessions/:key - Delete session
  authenticated.delete('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const result = await service.deleteSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/archive - Archive session
  authenticated.post('/api/sessions/:key/archive', async (c) => {
    const key = c.req.param('key');
    const result = await service.archiveSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unarchive - Unarchive session
  authenticated.post('/api/sessions/:key/unarchive', async (c) => {
    const key = c.req.param('key');
    const result = await service.unarchiveSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/pin - Pin session
  authenticated.post('/api/sessions/:key/pin', async (c) => {
    const key = c.req.param('key');
    const result = await service.pinSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unpin - Unpin session
  authenticated.post('/api/sessions/:key/unpin', async (c) => {
    const key = c.req.param('key');
    const result = await service.unpinSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/rename - Rename session
  authenticated.post('/api/sessions/:key/rename', async (c) => {
    const key = c.req.param('key');

    const body = await c.req.json();
    const { name } = body;
    const result = await service.renameSession(key, name);
    return c.json(result);
  });

  // ========== Subagent REST API (/api/subagents) ==========

  // GET /api/subagents - List subagent sessions
  authenticated.get('/api/subagents', async (c) => {
    const query = c.req.query();
    const result = await service.listSubagents({
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/subagents/:key - Get subagent session detail
  authenticated.get('/api/subagents/:key', async (c) => {
    const key = c.req.param('key');
    // Verify it's a subagent session
    if (!key.startsWith('subagent:')) {
      return c.json({ error: 'Not a subagent session' }, 400);
    }
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Subagent session not found' }, 404);
    }
    return c.json({ session });
  });

  // ========== Logs REST API (/api/logs) ==========

  // GET /api/logs - Query logs with filters
  authenticated.get('/api/logs', async (c) => {
    const query = c.req.query();
    const logs = await queryLogs({
      levels: query.level ? query.level.split(',') as LogLevel[] : undefined,
      from: query.from,
      to: query.to,
      q: query.q,
      module: query.module,
      limit: query.limit ? parseInt(query.limit) : 100,
      offset: query.offset ? parseInt(query.offset) : 0,
    });
    return c.json({ logs, count: logs.length });
  });

  // GET /api/logs/files - List log files
  authenticated.get('/api/logs/files', async (c) => {
    const files = getLogFiles();
    return c.json({ files });
  });

  // GET /api/logs/stats - Get log statistics
  authenticated.get('/api/logs/stats', async (c) => {
    const stats = getLogStats();
    return c.json(stats);
  });

  // GET /api/logs/levels - Get available log levels
  authenticated.get('/api/logs/levels', async (c) => {
    return c.json({ levels: getLogLevels() });
  });

  // GET /api/logs/modules - Get available modules
  authenticated.get('/api/logs/modules', async (c) => {
    const modules = await getLogModules();
    return c.json({ modules });
  });

  // GET /api/logs/dir - Get log directory path
  authenticated.get('/api/logs/dir', async (c) => {
    return c.json({ dir: LOG_DIR });
  });

  // ========== Plugin HTTP Routes ==========
  const pluginRegistry = service.getPluginRegistry?.();
  if (pluginRegistry) {
    // Register plugin HTTP routes
    const httpRoutes = pluginRegistry.httpRoutes;
    for (const [path, handler] of httpRoutes) {
      // POST handler
      authenticated.post(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
          body: await c.req.json().catch(() => ({})),
        };
        const res = {
          status: (code: number) => {
            c.status(code as any);
            return res;
          },
          json: (data: unknown) => c.json(data),
          send: (data: string) => c.text(data),
        };
        await handler(req as any, res as any);
        return c.text('');
      });

      // GET handler
      authenticated.get(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
        };
        const res = {
          status: (code: number) => {
            c.status(code as any);
            return res;
          },
          json: (data: unknown) => c.json(data),
          send: (data: string) => c.text(data),
        };
        await handler(req as any, res as any);
        return c.text('');
      });
    }
  }

  // ========== Plugin Gateway Methods ==========

  // POST /api/gateway/:method - Invoke a gateway method
  authenticated.post('/api/gateway/:method', async (c) => {
    const method = c.req.param('method');
    const params = await c.req.json().catch(() => ({}));
    try {
      const result = await service.invokeGatewayMethod(method, params);
      return c.json({ ok: true, result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  });

  // Mount authenticated routes
  app.route('/', authenticated);

  // UI static files (served at root)
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
