import type { Hono } from 'hono';

import {
  getModelsJsonPath,
  loadModelsJson,
  saveModelsJson,
  validateModelsConfig,
  type ProviderConfig,
} from '../../../config/models-json.js';
import type { Config } from '../../../config/schema.js';
import { parseModelRef } from '../../../config/schema.js';
import { testApiKeyResolution } from '../../../config/resolve-config-value.js';
import {
  getImageGenerationProvider,
  listImageGenerationProvidersSummary,
} from '../../../agent/image/generation/runtime.js';
import {
  EXTENSION_PROVIDER_BASE_URL,
  getAllModels,
  getAvailableModels,
  getModelRegistry,
  getAllProviders,
  getProviderAuthState,
  isProviderConfigured,
  PROVIDER_META,
  resolveModel,
} from '../../../providers/index.js';
import {
  getProviderHint,
  getOnboardingFeaturedProviders,
  getRecommendedModelsForProvider,
  isRecommendedModel,
  sortModelsForPicker,
  sortProvidersForPicker,
} from '../../../providers/presentation.js';
import {
  getDomesticProviderPreset,
  getDomesticProviderPresetIds,
} from '../../../providers/domestic-presets.js';
import { discoverProviderModels, isProviderApiDiscoverable } from '../../../providers/model-discovery.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { getProviderRegistry } from '../../../providers/plugin-registry.js';
import type { ProviderModelDefinition } from '../../../extensions/types/providers.js';
import type { GatewayService } from '../../service.js';
import {
  resolveCurrentImageModelCapabilities,
  resolveImageGenerationCapabilities,
  resolveImageUnderstandingCapabilities,
} from '../../image-capabilities.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { respondStartupUnavailable } from '../lib/startup-unavailable.js';

function readModelsJsonProviderApiKey(providerId: string): string | undefined {
  const { config } = loadModelsJson(getModelsJsonPath());
  const entry = config.providers?.[providerId.trim()];
  const key = entry?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Plaintext key only when persisted under `cfg.providers.<id>.apiKey` (not env / credential store). */
function readProviderApiKeyFromConfigFileOnly(cfg: Config, providerId: string): string | undefined {
  const id = providerId.trim().toLowerCase();
  const bucket = cfg.providers?.[id];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return undefined;
  const k = (bucket as { apiKey?: unknown }).apiKey;
  return typeof k === 'string' && k.trim() ? k.trim() : undefined;
}

/** Extension id from manifest `providers[]` (e.g. provider `demo` → extension `demo-provider`). */
function resolveExtensionIdForProvider(service: GatewayService, providerId: string): string | undefined {
  const loader = service.getExtensionLoader();
  if (!loader) return undefined;
  return loader.buildManifestRegistry().findByProvider(providerId)?.id;
}

/** Effective LLM REST base URL for a provider (models.json overrides included). */
function resolveProviderApiBaseUrl(providerId: string): string | undefined {
  const model = getModelRegistry().getAll().find((m) => m.provider === providerId);
  if (!model?.baseUrl || model.baseUrl === EXTENSION_PROVIDER_BASE_URL) return undefined;
  return model.baseUrl;
}

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
    recommended: isRecommendedModel(providerId, model.id),
    source: 'extension' as const,
  };
}

export function registerModelsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

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

  // POST /api/models-json/discover-models - Best-effort /models discovery for OpenAI-compatible providers
  authenticated.post('/api/models-json/discover-models', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rawProviderId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    const rawBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const rawApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;
    const api = typeof body.api === 'string' ? body.api : undefined;
    const headers = readStringRecord(body.headers);

    if (!rawProviderId) {
      return c.json({ ok: false, error: { message: 'Missing providerId' } }, 400);
    }
    if (!rawBaseUrl || !URL.canParse(rawBaseUrl)) {
      return c.json({ ok: false, error: { message: 'Missing or invalid baseUrl' } }, 400);
    }
    const providerApi = api as ProviderConfig['api'];
    if (!isProviderApiDiscoverable(providerApi)) {
      return c.json({ ok: false, error: { message: 'Model discovery requires an OpenAI-compatible API type' } }, 400);
    }

    try {
      const models = await discoverProviderModels({
        providerId: rawProviderId,
        baseUrl: rawBaseUrl,
        apiKey: rawApiKey,
        api: providerApi,
        headers,
      });
      return c.json({
        ok: true,
        payload: {
          models: models.map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
            input: model.input ?? ['text'],
            source: model.source,
          })),
        },
      });
    } catch (error) {
      return c.json(
        { ok: false, error: { message: error instanceof Error ? error.message : String(error) } },
        502,
      );
    }
  });

  // GET /api/models - Get available models (only configured providers)
  authenticated.get('/api/models', async (c) => {
    if (!service.isGatewayReady()) {
      return respondStartupUnavailable(c, 'models.list');
    }
    const pluginRegistry = getProviderRegistry();
    const models = sortModelsForPicker(await getAvailableModels()).map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes('image') ?? false,
      recommended: isRecommendedModel(m.provider, m.id),
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

    models.sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return c.json({ ok: true, payload: { models } });
  });

  authenticated.get('/api/image/capabilities', async (c) => {
    const config = service.currentConfig as Config;
    const agentId = c.req.query('agentId')?.trim() || undefined;
    const imageGenerationProviders = await resolveImageGenerationCapabilities(config);
    const imageUnderstandingProviders = await resolveImageUnderstandingCapabilities(config);
    return c.json({
      ok: true,
      payload: {
        current: resolveCurrentImageModelCapabilities(config, agentId),
        imageGeneration: { providers: imageGenerationProviders },
        imageUnderstanding: { providers: imageUnderstandingProviders },
      },
    });
  });

  authenticated.post('/api/image/validate-model', strictRateLimitMiddleware, async (c) => {
    let body: { modelRef?: unknown };
    try {
      body = (await c.req.json()) as { modelRef?: unknown };
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const modelRef = body.modelRef;
    if (!modelRef || typeof modelRef !== 'string') {
      return c.json({ ok: false, error: 'modelRef is required' }, 400);
    }

    const parsed = parseModelRef(modelRef);
    if (!parsed) {
      return c.json({
        ok: true,
        payload: {
          valid: false,
          reason: 'invalid_format',
          message: 'Model reference must be in "provider/model" format',
        },
      });
    }

    const configured = await isProviderConfigured(parsed.provider);
    if (!configured) {
      return c.json({
        ok: true,
        payload: {
          valid: false,
          reason: 'provider_not_configured',
          message: `Provider "${parsed.provider}" is not configured. Set the API key first.`,
          provider: parsed.provider,
        },
      });
    }

    try {
      resolveModel(modelRef);
    } catch {
      return c.json({
        ok: true,
        payload: {
          valid: false,
          reason: 'model_not_found',
          message: `Model not found in registry: ${modelRef}`,
          provider: parsed.provider,
          model: parsed.model,
        },
      });
    }

    return c.json({
      ok: true,
      payload: {
        valid: true,
        provider: parsed.provider,
        model: parsed.model,
      },
    });
  });

  // GET /api/image/providers — registered image generation providers and models (not in LLM model registry)
  authenticated.get('/api/image/providers', (c) => {
    const cfg = deps.service.currentConfig;
    const summaries = listImageGenerationProvidersSummary(cfg);
    const providers = summaries.map((p) => {
      const provider = getImageGenerationProvider(p.id, cfg);
      let configured = false;
      try {
        configured = provider?.isConfigured?.({ cfg }) === true;
      } catch {
        configured = false;
      }
      return { ...p, configured };
    });
    return c.json({ ok: true, payload: { providers } });
  });

  // POST /api/image/providers/:id/test — lightweight credential probe; does NOT
  // hit the vendor (no quota burn). Returns `{ ok, configured, reason }`.
  authenticated.post('/api/image/providers/:id/test', (c) => {
    const id = c.req.param('id');
    const cfg = deps.service.currentConfig;
    const provider = getImageGenerationProvider(id, cfg);
    if (!provider) {
      return c.json(
        { ok: false, error: { message: `Image generation provider not found: ${id}` } },
        404,
      );
    }
    let configured = false;
    let reason: string | undefined;
    try {
      configured = provider.isConfigured?.({ cfg }) === true;
      if (!configured) reason = 'Missing API key (set via config or environment).';
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    return c.json({
      ok: true,
      payload: {
        id: provider.id,
        configured,
        ...(reason ? { reason } : {}),
        defaultModel: provider.defaultModel ?? null,
      },
    });
  });

  /**
   * POST /api/image/providers/:id/reveal-api-key — return `cfg.providers.<id>.apiKey` plaintext for the
   * gateway console (same auth as PATCH /api/config). Does not resolve env vars or credential files.
   */
  authenticated.post(
    '/api/image/providers/:id/reveal-api-key',
    strictRateLimitMiddleware,
    async (c) => {
      const rawId = c.req.param('id');
      const cfg = deps.service.currentConfig;
      const provider = getImageGenerationProvider(rawId, cfg);
      if (!provider) {
        return c.json(
          { ok: false, error: { message: `Image generation provider not found: ${rawId}` } },
          404,
        );
      }
      const apiKey = readProviderApiKeyFromConfigFileOnly(cfg, provider.id);
      return c.json({
        ok: true,
        payload: {
          id: provider.id,
          apiKey: apiKey ?? null,
          source: apiKey ? ('config' as const) : ('none' as const),
        },
      });
    },
  );

  // GET /api/providers - Get ALL available providers and models
  authenticated.get('/api/providers', async (c) => {
    const pluginRegistry = getProviderRegistry();
    const allModels = getAllModels();
    const availableModels = await getAvailableModels();
    const configured = new Set(availableModels.map(m => `${m.provider}/${m.id}`));

    const models = sortModelsForPicker(allModels).map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes('image') ?? false,
      recommended: isRecommendedModel(m.provider, m.id),
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

    models.sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return c.json({ ok: true, payload: { models } });
  });

  // GET /api/providers/meta - Get provider metadata (categories, display names)
  authenticated.get('/api/providers/meta', async (c) => {
    const providers = sortProvidersForPicker([...new Set([...getAllProviders(), ...getDomesticProviderPresetIds()])]);
    const pluginRegistry = getProviderRegistry();

    const meta = await Promise.all(
      providers.map(async (provider) => {
        const plugin = pluginRegistry.get(provider);
        const domesticPreset = getDomesticProviderPreset(provider);
        const extensionId = plugin
          ? resolveExtensionIdForProvider(service, provider)
          : undefined;
        const authState = await getProviderAuthState(provider);
        const configured = authState.authMode !== 'none' || (await isProviderConfigured(provider));
        const registryModelCount = getAllModels().filter((m) => m.provider === provider).length;
        return {
          id: provider,
          name: plugin?.name ?? domesticPreset?.displayName ?? PROVIDER_META[provider]?.name ?? provider,
          category: plugin ? ('extension' as const) : PROVIDER_META[provider]?.category || (domesticPreset ? 'domestic' : 'specialty'),
          supportsOAuth: plugin ? false : (PROVIDER_META[provider]?.supportsOAuth ?? false),
          supportsApiKey: plugin ? false : (PROVIDER_META[provider]?.supportsApiKey ?? true),
          configured,
          onboardingFeatured: getOnboardingFeaturedProviders().includes(provider),
          recommendedModels: getRecommendedModelsForProvider(provider),
          modelCount: registryModelCount || domesticPreset?.models.length || 0,
          ...(getProviderHint(provider) ? { hint: getProviderHint(provider) } : {}),
          activeKeySource: authState.authMode,
          authMode: authState.authMode,
          authStatus: authState.authStatus,
          ...(authState.expiresAt ? { expiresAt: authState.expiresAt } : {}),
          baseUrl: resolveProviderApiBaseUrl(provider),
          ...(extensionId ? { extensionId } : {}),
        };
      }),
    );

    const knownProviderIds = new Set(providers);
    for (const plugin of pluginRegistry.listAll()) {
      if (!knownProviderIds.has(plugin.id)) {
        const extensionId = resolveExtensionIdForProvider(service, plugin.id);
        meta.push({
          id: plugin.id,
          name: plugin.name,
          category: 'extension',
          supportsOAuth: false,
          supportsApiKey: false,
          configured: true,
          onboardingFeatured: false,
          recommendedModels: getRecommendedModelsForProvider(plugin.id),
          modelCount: plugin.models.length,
          activeKeySource: 'extension',
          authMode: 'extension',
          authStatus: 'connected',
          baseUrl: resolveProviderApiBaseUrl(plugin.id),
          ...(extensionId ? { extensionId } : {}),
        });
      }
    }

    return c.json({ ok: true, payload: { providers: meta } });
  });

  /**
   * POST /api/providers/:providerId/reveal-api-key — plaintext key when stored in the
   * gateway credential store or models.json (not env vars or OAuth tokens).
   */
  authenticated.post(
    '/api/providers/:providerId/reveal-api-key',
    strictRateLimitMiddleware,
    async (c) => {
      const rawId = c.req.param('providerId')?.trim();
      if (!rawId) {
        return c.json({ ok: false, error: { message: 'Missing providerId' } }, 400);
      }
      const providerId = rawId.toLowerCase();
      const resolver = new CredentialResolver();
      const stored = await resolver.revealGatewayStoredApiKey(providerId);
      if (stored) {
        return c.json({
          ok: true,
          payload: { id: providerId, apiKey: stored, source: 'credential' as const },
        });
      }
      const fromModelsJson = readModelsJsonProviderApiKey(providerId);
      if (fromModelsJson) {
        return c.json({
          ok: true,
          payload: { id: providerId, apiKey: fromModelsJson, source: 'models_json' as const },
        });
      }
      return c.json({
        ok: true,
        payload: { id: providerId, apiKey: null, source: 'none' as const },
      });
    },
  );

  // DELETE /api/providers/:providerId/key - Remove a provider's stored API key
  authenticated.delete('/api/providers/:providerId/key', strictRateLimitMiddleware, async (c) => {
    const providerId = c.req.param('providerId');
    if (!providerId) {
      return c.json({ ok: false, error: { message: 'Missing providerId' } }, 400);
    }

    const normalizedProvider = providerId.toLowerCase();
    const resolver = new CredentialResolver();

    try {
      await resolver.deleteProviderCredential(normalizedProvider);
      return c.json({ ok: true, payload: { deleted: normalizedProvider } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: { message: `Failed to delete key: ${errorMessage}` } }, 500);
    }
  });
}
