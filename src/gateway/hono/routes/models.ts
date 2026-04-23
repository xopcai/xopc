import type { Hono } from 'hono';

import {
  getModelsJsonPath,
  loadModelsJson,
  saveModelsJson,
  validateModelsConfig,
} from '../../../config/models-json.js';
import { testApiKeyResolution } from '../../../config/resolve-config-value.js';
import { listImageGenerationProvidersSummary } from '../../../agent/image/generation/runtime.js';
import {
  getAllModels,
  getAvailableModels,
  getModelRegistry,
  getAllProviders,
  getProviderActiveKeySource,
  isProviderConfigured,
  PROVIDER_META,
} from '../../../providers/index.js';
import { getProviderRegistry } from '../../../providers/plugin-registry.js';
import type { ProviderModelDefinition } from '../../../extensions/types/providers.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function mapPluginModel(providerId: string, model: ProviderModelDefinition, available: boolean) {
  return {
    id: `${providerId}/${model.id}`,
    name: model.name,
    provider: providerId,
    contextWindow: model.contextWindow ?? 128000,
    maxTokens: model.maxOutputTokens ?? 4096,
    reasoning: false,
    vision: model.supportsImages ?? false,
    cost: { input: model.pricing?.input ?? 0, output: model.pricing?.output ?? 0 },
    available,
    source: 'extension' as const,
  };
}

export function registerModelsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

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
    const pluginRegistry = getProviderRegistry();
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
      ...(pluginRegistry.has(m.provider) ? { source: 'extension' as const } : {}),
    }));

    const existingIds = new Set(models.map(m => m.id));
    for (const plugin of pluginRegistry.listAll()) {
      for (const model of plugin.models) {
        const compositeId = `${plugin.id}/${model.id}`;
        if (!existingIds.has(compositeId)) {
          models.push(mapPluginModel(plugin.id, model, true));
          existingIds.add(compositeId);
        }
      }
    }

    // Sort by provider then name
    models.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    return c.json({ ok: true, payload: { models } });
  });

  // GET /api/image/providers — registered image generation providers and models (not in LLM model registry)
  authenticated.get('/api/image/providers', (c) => {
    const providers = listImageGenerationProvidersSummary();
    return c.json({ ok: true, payload: { providers } });
  });

  // GET /api/providers - Get ALL available providers and models
  authenticated.get('/api/providers', async (c) => {
    const pluginRegistry = getProviderRegistry();
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
      ...(pluginRegistry.has(m.provider) ? { source: 'extension' as const } : {}),
    }));

    const existingIds = new Set(models.map(m => m.id));
    for (const plugin of pluginRegistry.listAll()) {
      for (const model of plugin.models) {
        const compositeId = `${plugin.id}/${model.id}`;
        if (!existingIds.has(compositeId)) {
          models.push(mapPluginModel(plugin.id, model, configured.has(compositeId)));
          existingIds.add(compositeId);
        }
      }
    }

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
    const pluginRegistry = getProviderRegistry();

    const meta = await Promise.all(
      providers.map(async (provider) => {
        const plugin = pluginRegistry.get(provider);
        return {
          id: provider,
          name: plugin?.name ?? PROVIDER_META[provider]?.name ?? provider,
          category: plugin ? ('extension' as const) : PROVIDER_META[provider]?.category || 'specialty',
          supportsOAuth: plugin ? false : (PROVIDER_META[provider]?.supportsOAuth ?? false),
          supportsApiKey: plugin ? true : (PROVIDER_META[provider]?.supportsApiKey ?? true),
          configured: await isProviderConfigured(provider),
          activeKeySource: await getProviderActiveKeySource(provider),
        };
      }),
    );

    const knownProviderIds = new Set(providers);
    for (const plugin of pluginRegistry.listAll()) {
      if (!knownProviderIds.has(plugin.id)) {
        meta.push({
          id: plugin.id,
          name: plugin.name,
          category: 'extension',
          supportsOAuth: false,
          supportsApiKey: true,
          configured: true,
          activeKeySource: 'extension',
        });
      }
    }

    return c.json({ ok: true, payload: { providers: meta } });
  });
}
