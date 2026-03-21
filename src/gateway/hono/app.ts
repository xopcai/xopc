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
import { getVoiceModelsConfig } from '../../config/voice.js';
import { createLogger } from '../../utils/logger.js';
import { queryLogs, getLogFiles, getLogLevels, getLogStats, getLogModules, LOG_DIR } from '../../utils/log-store.js';
import type { LogLevel } from '../../utils/logger.types.js';
import { 
  getAllModels, 
  getAvailableModels, 
  getAllProviders, 
  isProviderConfigured,
  PROVIDER_META,
  getModelRegistry,
  type Model,
  type Api,
} from '../../providers/index.js';
import { createOAuthHandler, loadOAuthCredentialsToCache } from './oauth.js';
import { createOAuthAsyncHandler } from './oauth-async.js';
import { testApiKeyResolution } from '../../config/resolve-config-value.js';
import { buildSessionKey } from '../../routing/session-key.js';
import { 
  getModelsJsonPath,
  loadModelsJson,
  saveModelsJson,
  validateModelsConfig,
} from '../../config/models-json.js';
import { CredentialResolver } from '../../auth/credentials.js';

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

  // UI static files (no auth required)
  // Must be before authenticated routes
  app.get('/assets/*', (c) => {
    const path = c.req.path.replace('/assets/', '');
    const response = serveStaticFile(`assets/${path}`);
    if (response) return response;
    return c.text('Not found', 404);
  });

  // Favicon (no auth required)
  app.get('/favicon.ico', (c) => {
    const response = serveStaticFile('favicon.ico');
    if (response) return response;
    return c.text('Not found', 404);
  });

  // Root path - serve UI (no auth required for the page itself)
  app.get('/', (c) => {
    const response = serveStaticFile('index.html');
    if (response) return response;
    return c.text('UI not found', 404);
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
  authenticated.get('/api/config', async (c) => {
    const config = service.currentConfig;
    const safeConfig = {
      agents: {
        defaults: {
          model: config.agents?.defaults?.model,
          maxTokens: config.agents?.defaults?.maxTokens,
          temperature: config.agents?.defaults?.temperature,
          maxToolIterations: config.agents?.defaults?.maxToolIterations,
          workspace: config.agents?.defaults?.workspace,
          thinkingDefault: config.agents?.defaults?.thinkingDefault,
          reasoningDefault: config.agents?.defaults?.reasoningDefault,
          verboseDefault: config.agents?.defaults?.verboseDefault,
          compaction: config.agents?.defaults?.compaction,
          pruning: config.agents?.defaults?.pruning,
        },
      },
      channels: {
        telegram: {
          enabled: config.channels?.telegram?.enabled,
          botToken: config.channels?.telegram?.botToken || '',
          allowFrom: config.channels?.telegram?.allowFrom || [],
          groupAllowFrom: config.channels?.telegram?.groupAllowFrom || [],
          apiRoot: config.channels?.telegram?.apiRoot || '',
          debug: config.channels?.telegram?.debug || false,
          dmPolicy: config.channels?.telegram?.dmPolicy || 'pairing',
          groupPolicy: config.channels?.telegram?.groupPolicy || 'open',
          replyToMode: config.channels?.telegram?.replyToMode || 'off',
          streamMode: config.channels?.telegram?.streamMode || 'partial',
          historyLimit: config.channels?.telegram?.historyLimit || 50,
          textChunkLimit: config.channels?.telegram?.textChunkLimit || 4000,
          proxy: config.channels?.telegram?.proxy || '',
          accounts: config.channels?.telegram?.accounts || {},
        },
      },
      // Provider API keys - check credential system for configured status
      providers: Object.fromEntries(
        await Promise.all(
          getAllProviders().map(async (provider) => [
            provider,
            (await isProviderConfigured(provider)) ? '***' : ''
          ])
        )
      ),
      gateway: {
        host: config.gateway?.host,
        port: config.gateway?.port,
        auth: {
          mode: config.gateway?.auth?.mode || 'token',
          token: config.gateway?.auth?.token || '',
        },
        heartbeat: {
          enabled: config.gateway?.heartbeat?.enabled,
          intervalMs: config.gateway?.heartbeat?.intervalMs,
        },
      },
      cron: { enabled: config.cron?.enabled },
      stt: config.stt,
      tts: config.tts,
    };
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  // GET /api/voice/models - Get available STT/TTS models
  authenticated.get('/api/voice/models', (c) => {
    const models = getVoiceModelsConfig();
    return c.json({ ok: true, payload: { models } });
  });

  // PATCH /api/config - Update partial config
  authenticated.patch('/api/config', async (c) => {
    const body = await c.req.json();
    
    // Merge updates into current config
    const config: Config = service.currentConfig as Config;
    
    // Update agent defaults
    if (body.agents?.defaults) {
      if (!config.agents) config.agents = { defaults: { workspace: '~/.xopcbot/workspace', model: 'anthropic/claude-sonnet-4-5', maxTokens: 8192, temperature: 0.7, maxToolIterations: 20, maxRequestsPerTurn: 50, maxToolFailuresPerTurn: 3, thinkingDefault: 'medium', reasoningDefault: 'off', verboseDefault: 'off' } };
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
      if (body.agents.defaults.thinkingDefault !== undefined) {
        config.agents.defaults.thinkingDefault = body.agents.defaults.thinkingDefault;
      }
      if (body.agents.defaults.reasoningDefault !== undefined) {
        config.agents.defaults.reasoningDefault = body.agents.defaults.reasoningDefault;
      }
      if (body.agents.defaults.verboseDefault !== undefined) {
        config.agents.defaults.verboseDefault = body.agents.defaults.verboseDefault;
      }
    }
    
    // Update channels
    if (body.channels?.telegram) {
      if (!config.channels) config.channels = { telegram: { enabled: false, botToken: '', allowFrom: [], groupAllowFrom: [], debug: false, dmPolicy: 'pairing' as const, groupPolicy: 'open' as const, replyToMode: 'off' as const, historyLimit: 50, textChunkLimit: 4000 } };
      if (!config.channels.telegram) config.channels.telegram = {} as any;
      
      if (body.channels.telegram.enabled !== undefined) {
        config.channels.telegram.enabled = body.channels.telegram.enabled;
      }
      if (body.channels.telegram.botToken !== undefined) {
        config.channels.telegram.botToken = body.channels.telegram.botToken;
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
      if (body.channels.telegram.streamMode !== undefined) {
        config.channels.telegram.streamMode = body.channels.telegram.streamMode;
      }
      if (body.channels.telegram.groupAllowFrom !== undefined) {
        config.channels.telegram.groupAllowFrom = body.channels.telegram.groupAllowFrom;
      }
      if (body.channels.telegram.dmPolicy !== undefined) {
        config.channels.telegram.dmPolicy = body.channels.telegram.dmPolicy;
      }
      if (body.channels.telegram.groupPolicy !== undefined) {
        config.channels.telegram.groupPolicy = body.channels.telegram.groupPolicy;
      }
      if (body.channels.telegram.replyToMode !== undefined) {
        config.channels.telegram.replyToMode = body.channels.telegram.replyToMode;
      }
      if (body.channels.telegram.historyLimit !== undefined) {
        config.channels.telegram.historyLimit = body.channels.telegram.historyLimit;
      }
      if (body.channels.telegram.textChunkLimit !== undefined) {
        config.channels.telegram.textChunkLimit = body.channels.telegram.textChunkLimit;
      }
      if (body.channels.telegram.proxy !== undefined) {
        config.channels.telegram.proxy = body.channels.telegram.proxy;
      }
      if (body.channels.telegram.accounts !== undefined) {
        config.channels.telegram.accounts = body.channels.telegram.accounts;
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
    
    // Update providers config - save to credential system instead of config
    if (body.providers) {
      const resolver = new CredentialResolver();
      for (const [key, apiKey] of Object.entries(body.providers)) {
        if (apiKey !== undefined && typeof apiKey === 'string' && apiKey.trim() && apiKey !== '***') {
          await resolver.saveApiKey(key, apiKey, { profileName: 'default' });
        }
      }
    }

    // Update STT config
    if (body.stt !== undefined) {
      config.stt = body.stt;
    }

    // Update TTS config
    if (body.tts !== undefined) {
      config.tts = body.tts;
    }
    
    // Save config
    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }
    
    return c.json({ ok: true, payload: { config } });
  });

  // ========== Auth API (/api/auth) ==========

  // GET /api/auth/token - Get current gateway token
  authenticated.get('/api/auth/token', (c) => {
    const authToken = service.getAuthToken();
    return c.json({ 
      ok: true, 
      payload: { 
        token: authToken,
        mode: service.getAuthMode(),
      } 
    });
  });

  // POST /api/auth/token/refresh - Generate new gateway token
  authenticated.post('/api/auth/token/refresh', async (c) => {
    try {
      const newToken = await service.refreshAuthToken();
      return c.json({ 
        ok: true, 
        payload: { 
          token: newToken,
          message: 'Token refreshed successfully. Please update your client configuration.'
        } 
      });
    } catch (err) {
      return c.json({ 
        ok: false, 
        error: err instanceof Error ? err.message : 'Failed to refresh token' 
      }, 500);
    }
  });

  // ========== OAuth API (/api/auth/oauth) ==========
  authenticated.route('/api/auth/oauth', createOAuthHandler(service));

  // ========== Async OAuth API (/api/auth/oauth-async) ==========
  authenticated.route('/api/auth/oauth-async', createOAuthAsyncHandler(service));

  // Load OAuth credentials from config into cache on startup
  loadOAuthCredentialsToCache(service);

  // ========== Registry API ==========
  
  // GET /api/registry - Full registry for frontend
  authenticated.get('/api/registry', async (c) => {
    const allModels = getAllModels();
    const availableModels = await getAvailableModels();
    const configured = new Set(availableModels.map(m => `${m.provider}/${m.id}`));
    
    // Group models by provider
    const providerMap = new Map<string, Model<Api>[]>();
    for (const model of allModels) {
      const list = providerMap.get(model.provider) ?? [];
      list.push(model);
      providerMap.set(model.provider, list);
    }
    
    return c.json({
      ok: true,
      payload: {
        version: 'pi-ai',
        providers: Array.from(providerMap.entries()).map(([id, models]) => ({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          configured: models.some(m => configured.has(`${m.provider}/${m.id}`)),
          models: models.map(m => ({
            ref: `${m.provider}/${m.id}`,
            id: m.id,
            name: m.name,
            provider: m.provider,
            reasoning: m.reasoning ?? false,
            input: m.input ?? ['text'],
            contextWindow: m.contextWindow ?? 128000,
            maxTokens: m.maxTokens ?? 4096,
            cost: {
              input: m.cost?.input ?? 0,
              output: m.cost?.output ?? 0,
            },
            available: configured.has(`${m.provider}/${m.id}`),
          })),
        })),
      },
    });
  });

  // POST /api/registry/reload - Hot reload (no-op with pi-ai, but keep for compatibility)
  authenticated.post('/api/registry/reload', async (c) => {
    try {
      // Reload config
      await service.reloadConfig();
      
      // Reload OAuth credentials from new config
      loadOAuthCredentialsToCache(service);
      
      const models = getAllModels();
      
      // Emit SSE event to all connected clients
      service.emit('registry.updated', { modelCount: models.length });
      
      return c.json({
        ok: true,
        payload: {
          message: 'Registry reloaded',
          modelCount: models.length,
        },
      });
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : 'Failed to reload registry',
      }, 500);
    }
  });

  // ========== Models.json API ==========

  // GET /api/models-json - Get models.json configuration
  authenticated.get('/api/models-json', async (c) => {
    const path = getModelsJsonPath();
    const { config, error } = loadModelsJson(path);
    const registry = getModelRegistry();
    
    return c.json({
      ok: true,
      payload: {
        config,
        path,
        exists: error === undefined,
        loadError: error || registry.getError(),
      },
    });
  });

  // POST /api/models-json/validate - Validate models.json configuration
  authenticated.post('/api/models-json/validate', async (c) => {
    const body = await c.req.json();
    const { config } = body;
    
    const result = validateModelsConfig(config);
    
    return c.json({
      ok: true,
      payload: result,
    });
  });

  // PATCH /api/models-json - Save models.json configuration
  authenticated.patch('/api/models-json', async (c) => {
    const body = await c.req.json();
    const { config } = body;
    
    const path = getModelsJsonPath();
    const result = saveModelsJson(path, config);
    
    if (!result.success) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    
    // Refresh registry
    const registry = getModelRegistry();
    registry.refresh();
    
    // Emit event
    service.emit('models-json.updated', { 
      modelCount: registry.getAll().length,
    });
    
    return c.json({ 
      ok: true, 
      payload: { 
        saved: true,
        modelCount: registry.getAll().length,
      },
    });
  });

  // POST /api/models-json/reload - Hot reload models.json
  authenticated.post('/api/models-json/reload', async (c) => {
    const registry = getModelRegistry();
    registry.refresh();
    
    const error = registry.getError();
    const models = registry.getAll();
    
    service.emit('models-json.reloaded', { 
      modelCount: models.length,
      error: error || undefined,
    });
    
    return c.json({
      ok: true,
      payload: {
        modelCount: models.length,
        error,
      },
    });
  });

  // POST /api/models-json/test-api-key - Test API key resolution
  authenticated.post('/api/models-json/test-api-key', async (c) => {
    const body = await c.req.json();
    const { value } = body;
    
    const result = testApiKeyResolution(value);
    
    return c.json({
      ok: true,
      payload: result,
    });
  });

  // GET /api/models - Get available models (only configured providers)
  authenticated.get('/api/models', async (c) => {
    const models = (await getAvailableModels()).map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes('image') ?? false,
      cost: {
        input: m.cost?.input ?? 0,
        output: m.cost?.output ?? 0,
      },
    }));

    // Sort by provider then name
    models.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    return c.json({ ok: true, payload: { models } });
  });

  // GET /api/providers - Get ALL available providers and models
  authenticated.get('/api/providers', async (c) => {
    const allModels = getAllModels();
    const availableModels = await getAvailableModels();
    const configured = new Set(availableModels.map(m => `${m.provider}/${m.id}`));
    
    const models = allModels.map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes('image') ?? false,
      cost: {
        input: m.cost?.input ?? 0,
        output: m.cost?.output ?? 0,
      },
      available: configured.has(`${m.provider}/${m.id}`),
    }));

    // Sort by provider then name
    models.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    return c.json({ ok: true, payload: { models } });
  });

  // GET /api/providers/meta - Get provider metadata (categories, display names)
  authenticated.get('/api/providers/meta', async (c) => {
    const providers = getAllProviders();
    
    const meta = await Promise.all(providers.map(async provider => ({
      id: provider,
      name: PROVIDER_META[provider]?.name || provider,
      category: PROVIDER_META[provider]?.category || 'specialty',
      supportsOAuth: PROVIDER_META[provider]?.supportsOAuth ?? false,
      supportsApiKey: PROVIDER_META[provider]?.supportsApiKey ?? true,
      configured: await isProviderConfigured(provider),
    })));

    return c.json({ ok: true, payload: { providers: meta } });
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
    const { schedule, name, timezone, sessionTarget, model, delivery, payload } = body;

    if (!schedule || !payload) {
      return c.json({ error: 'Missing required fields: schedule, payload' }, 400);
    }

    try {
      const result = await service.cronServiceInstance.addJob(schedule, {
        name,
        timezone,
        sessionTarget,
        model,
        delivery,
        payload,
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

  // POST /api/sessions - Create new session (reuses empty sessions)
  authenticated.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel || 'webchat';
    
    // If a specific chat_id is provided, use it (for advanced use cases)
    // Otherwise, try to find and reuse an existing empty session
    if (body.chat_id) {
      const sessionKey = buildSessionKey({
        agentId: 'main',
        source: channel,
        accountId: 'default',
        peerKind: 'direct',
        peerId: body.chat_id,
      });

      await service.sessionManagerInstance.saveMessages(sessionKey, []);
      const session = await service.getSession(sessionKey);
      return c.json({ session }, 201);
    }
    
    // Look for existing empty sessions to reuse
    const existingSessions = await service.listSessions({
      channel,
      limit: 50,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    
    // Find the first empty session (messageCount === 0)
    const emptySession = existingSessions.items.find(s => s.messageCount === 0);
    
    if (emptySession) {
      // Return existing empty session instead of creating a new one
      const session = await service.getSession(emptySession.key);
      return c.json({ session, reused: true }, 200);
    }
    
    // No empty session found, create a new one
    const chatId = `chat_${Date.now()}`;
    const sessionKey = buildSessionKey({
      agentId: 'main',
      source: channel,
      accountId: 'default',
      peerKind: 'direct',
      peerId: chatId,
    });

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

  // GET /api/sessions/chat-ids - Get unique chat IDs from sessions (must be before /:key)
  authenticated.get('/api/sessions/chat-ids', async (c) => {
    const channel = c.req.query('channel');
    const chatIds = await service.getSessionChatIds(channel || undefined);
    return c.json({ ok: true, payload: { chatIds } });
  });

  // GET /api/sessions/:key - Get single session (must be after /stats and /chat-ids)
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

  // GET /api/logs/health - Get log system health status
  authenticated.get('/api/logs/health', async (c) => {
    const { getLogDir, getLogStats, isLoggerShuttingDown } = await import('../../utils/logger.js');
    const { getLogFiles } = await import('../../utils/log-store.js');
    
    const stats = getLogStats();
    const files = getLogFiles().slice(0, 5);
    const isShuttingDown = isLoggerShuttingDown();
    
    return c.json({
      status: isShuttingDown ? 'shutting_down' : 'healthy',
      config: {
        dir: getLogDir(),
        uptimeMs: stats.uptimeMs,
      },
      stats: {
        byLevel: stats.byLevel,
        errorsLast24h: stats.errorsLast24h,
        modulesTracked: stats.byModule ? Object.keys(stats.byModule).length : 0,
      },
      files: files.map(f => ({
        name: f.name,
        size: f.size,
        modified: f.modified,
        type: f.type,
      })),
      shuttingDown: isShuttingDown,
    });
  });

  // POST /api/logs/level - Set log level dynamically
  authenticated.post('/api/logs/level', async (c) => {
    const { setLogLevel, getLogLevel } = await import('../../utils/logger.js');
    const body = await c.req.json().catch(() => ({}));
    const { level, duration } = body as { level?: string; duration?: string };
    
    if (!level) {
      return c.json({ error: 'level is required' }, 400);
    }
    
    const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    if (!validLevels.includes(level)) {
      return c.json({ error: `Invalid level. Must be one of: ${validLevels.join(', ')}` }, 400);
    }
    
    const previousLevel = getLogLevel();
    setLogLevel(level as any);
    
    // Optional: auto-revert after duration
    let autoRevertAt: string | null = null;
    if (duration) {
      const durationMs = parseInt(duration) * 60000; // minutes to ms
      if (!isNaN(durationMs) && durationMs > 0) {
        autoRevertAt = new Date(Date.now() + durationMs).toISOString();
        setTimeout(() => {
          setLogLevel(previousLevel);
          console.log(`[Logger] Auto-reverted log level to ${previousLevel}`);
        }, durationMs);
      }
    }
    
    return c.json({
      previous: previousLevel,
      current: level,
      autoRevertAt,
      message: `Log level changed from ${previousLevel} to ${level}`,
    });
  });

  // GET /api/logs/level - Get current log level
  authenticated.get('/api/logs/level', async (c) => {
    const { getLogLevel } = await import('../../utils/logger.js');
    return c.json({ level: getLogLevel() });
  });

  // ========== Real-time Log Streaming (SSE) ==========

  // GET /api/logs/stream - Stream logs in real-time via SSE
  authenticated.get('/api/logs/stream', async (c) => {
    const { createLogSSEHandler } = await import('../../utils/log-stream.js');
    return createLogSSEHandler()(c);
  });

  // ========== Extension HTTP Routes ==========
  const extensionRegistry = service.getExtensionRegistry?.();
  if (extensionRegistry) {
    // Register extension HTTP routes
    const httpRoutes = extensionRegistry.httpRoutes;
    for (const [path, handler] of httpRoutes) {
      // POST handler
      authenticated.post(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
          body: await c.req.json().catch(() => ({})),
        };
        const response = await handler(req as any);
        if (response) {
          if (response.status) c.status(response.status as any);
          if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
              c.header(key, value);
            }
          }
          if (response.body !== undefined) {
            return c.json(response.body);
          }
        }
        return c.text('');
      });

      // GET handler
      authenticated.get(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
        };
        const response = await handler(req as any);
        if (response) {
          if (response.status) c.status(response.status as any);
          if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
              c.header(key, value);
            }
          }
          if (response.body !== undefined) {
            return c.json(response.body);
          }
        }
        return c.text('');
      });
    }
  }

  // ========== Extension Gateway Methods ==========

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
