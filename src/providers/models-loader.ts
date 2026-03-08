/**
 * Unified Model Registry Loader
 * 
 * Loads, validates, and merges model registry from multiple sources:
 * 1. Built-in manifest (models.json)
 * 2. pi-ai npm models
 * 3. User config (config.json models.providers)
 * 4. Ollama discovery (async)
 */

import manifestData from './models.json' with { type: 'json' };
import type { ModelsManifest, ResolvedModel, ResolvedProvider, ProviderEntry, ModelEntry } from './models.types.js';
import type { Config } from '../config/schema.js';
import { getModels as getPiAiModels, getProviders as getPiAiProviders } from '@mariozechner/pi-ai';

// Re-export types
export type { ModelsManifest, ResolvedModel, ResolvedProvider, ProviderEntry, ModelEntry };

let currentManifest: ModelsManifest = manifestData as ModelsManifest;

/** Get the built-in manifest */
export function getManifest(): ModelsManifest {
  return currentManifest;
}

/** Hot-reload: replace manifest */
export function reloadManifest(newManifest: ModelsManifest): void {
  currentManifest = newManifest;
}

/** Get manifest version */
export function getManifestVersion(): string {
  return currentManifest.version;
}

/** Convert manifest provider to resolved provider */
function toResolvedProvider(
  entry: [string, ProviderEntry],
  configured: boolean = false
): ResolvedProvider {
  const [id, provider] = entry;
  
  const models: ResolvedModel[] = provider.models.map(m => ({
    ref: `${id}/${m.id}`,
    id: m.id,
    name: m.name,
    provider: id,
    providerName: provider.name,
    api: provider.api,
    baseUrl: provider.baseUrl,
    reasoning: m.reasoning ?? false,
    input: m.input ?? ['text'],
    contextWindow: m.contextWindow ?? 128000,
    maxTokens: m.maxTokens ?? 4096,
    cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0 },
    compat: m.compat,
    headers: m.headers,
    recommended: m.recommended ?? false,
    deprecated: m.deprecated ?? false,
    source: 'builtin' as const,
  }));

  return {
    id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api,
    auth: provider.auth,
    capabilities: provider.capabilities,
    modelPrefixes: provider.modelPrefixes ?? [],
    configured,
    models,
  };
}

/** Load pi-ai models as additional layer */
function loadPiAiModels(): Map<string, ModelEntry[]> {
  const result = new Map<string, ModelEntry[]>();
  
  const providers = getPiAiProviders() as string[];
  for (const providerId of providers) {
    try {
      const piAiModels = getPiAiModels(providerId as any);
      const entries: ModelEntry[] = piAiModels.map(m => ({
        id: m.id,
        name: m.name || m.id,
        reasoning: m.reasoning ?? false,
        input: (m.input as any)?.includes('image') ? ['text', 'image'] : ['text'],
        contextWindow: m.contextWindow ?? 128000,
        maxTokens: m.maxTokens ?? 8192,
        cost: {
          input: m.cost?.input ?? 0,
          output: m.cost?.output ?? 0,
        },
      }));
      result.set(providerId, entries);
    } catch {
      // Skip providers that fail to load
    }
  }
  
  return result;
}

/**
 * Build the full resolved registry by merging layers:
 * 1. Built-in manifest (models.json)
 * 2. pi-ai npm models (additive)
 * 3. User config (config.json models.providers)
 */
export function buildRegistry(config?: Config): ResolvedProvider[] {
  const piAiModels = loadPiAiModels();
  const userProviders = config?.models?.providers ?? {};
  const mergeMode = config?.models?.mode ?? 'merge';
  
  // Start with built-in manifest
  const providersMap = new Map<string, ResolvedProvider>();
  
  // Layer 1: Built-in manifest
  for (const entry of Object.entries(currentManifest.providers)) {
    const [id, provider] = entry;
    // Check if user configured this provider
    const userConfig = userProviders[id];
    const configured = !!(userConfig?.apiKey || userConfig?.oauth);
    
    providersMap.set(id, toResolvedProvider(entry, configured));
  }
  
  // Layer 2: pi-ai models (additive - only add models not in built-in)
  if (mergeMode !== 'replace') {
    for (const [providerId, models] of piAiModels) {
      const existing = providersMap.get(providerId);
      if (existing) {
        // Add pi-ai models that don't exist in built-in
        for (const model of models) {
          if (!existing.models.find(m => m.id === model.id)) {
            existing.models.push({
              ref: `${providerId}/${model.id}`,
              id: model.id,
              name: model.name,
              provider: providerId,
              providerName: existing.name,
              api: existing.api,
              baseUrl: existing.baseUrl,
              reasoning: model.reasoning ?? false,
              input: model.input ?? ['text'],
              contextWindow: model.contextWindow ?? 128000,
              maxTokens: model.maxTokens ?? 4096,
              cost: { input: model.cost?.input ?? 0, output: model.cost?.output ?? 0 },
              recommended: false,
              deprecated: false,
              source: 'pi-ai',
            });
          }
        }
      } else {
        // Add new provider from pi-ai
        providersMap.set(providerId, {
          id: providerId,
          name: providerId.charAt(0).toUpperCase() + providerId.slice(1),
          baseUrl: '',
          api: 'openai-completions',
          auth: { type: 'api_key', envKeys: [] },
          capabilities: { streaming: true, functionCalling: false, vision: false, reasoning: false },
          modelPrefixes: [],
          configured: false,
          models: models.map(m => ({
            ref: `${providerId}/${m.id}`,
            id: m.id,
            name: m.name,
            provider: providerId,
            providerName: providerId,
            api: 'openai-completions',
            baseUrl: '',
            reasoning: m.reasoning ?? false,
            input: m.input ?? ['text'],
            contextWindow: m.contextWindow ?? 128000,
            maxTokens: m.maxTokens ?? 4096,
            cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0 },
            recommended: false,
            deprecated: false,
            source: 'pi-ai',
          })),
        });
      }
    }
  }
  
  // Layer 3: User config (override/add)
  for (const [providerId, userConfig] of Object.entries(userProviders)) {
    const existing = providersMap.get(providerId);
    
    if (existing) {
      // Override existing provider config
      if (userConfig.baseUrl) existing.baseUrl = userConfig.baseUrl;
      if (userConfig.api) existing.api = userConfig.api as any;
      if (userConfig.apiKey || userConfig.oauth) existing.configured = true;
      
      // Add or override models
      if (userConfig.models && userConfig.models.length > 0) {
        // If replace mode, clear existing models first
        if (mergeMode === 'replace') {
          existing.models = [];
        }
        
        for (const model of userConfig.models) {
          const existingIndex = existing.models.findIndex(m => m.id === model.id);
          const modelCost = model.cost || { input: 0, output: 0 };
          const modelEntry: ResolvedModel = {
            ref: `${providerId}/${model.id}`,
            id: model.id,
            name: model.name || model.id,
            provider: providerId,
            providerName: existing.name,
            api: existing.api,
            baseUrl: existing.baseUrl,
            reasoning: model.reasoning ?? false,
            input: (model.input as any) ?? ['text'],
            contextWindow: model.contextWindow ?? 128000,
            maxTokens: model.maxTokens ?? 4096,
            cost: {
              input: modelCost.input ?? 0,
              output: modelCost.output ?? 0,
              cacheRead: modelCost.cacheRead,
              cacheWrite: modelCost.cacheWrite,
            },
            recommended: false,
            deprecated: false,
            source: 'user',
          };
          
          if (existingIndex >= 0) {
            // Override existing model
            existing.models[existingIndex] = modelEntry;
          } else {
            // Add new model
            existing.models.push(modelEntry);
          }
        }
      }
    } else {
      // Add new custom provider
      providersMap.set(providerId, {
        id: providerId,
        name: providerId,
        baseUrl: userConfig.baseUrl || '',
        api: (userConfig.api as any) || 'openai-completions',
        auth: { type: 'api_key', envKeys: [] },
        capabilities: { streaming: true, functionCalling: false, vision: false, reasoning: false },
        modelPrefixes: [],
        configured: !!(userConfig.apiKey || userConfig.oauth),
        models: (userConfig.models || []).map(m => ({
          ref: `${providerId}/${m.id}`,
          id: m.id,
          name: m.name || m.id,
          provider: providerId,
          providerName: providerId,
          api: (userConfig.api as any) || 'openai-completions',
          baseUrl: userConfig.baseUrl || '',
          reasoning: m.reasoning ?? false,
          input: (m.input as any) ?? ['text'],
          contextWindow: m.contextWindow ?? 128000,
          maxTokens: m.maxTokens ?? 4096,
          cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0 },
          recommended: false,
          deprecated: false,
          source: 'user' as const,
        })),
      });
    }
  }
  
  return Array.from(providersMap.values());
}

/** Get flat list of all configured models */
export function getConfiguredModels(config?: Config): ResolvedModel[] {
  const registry = buildRegistry(config);
  return registry.filter(p => p.configured).flatMap(p => p.models);
}

/** Get flat list of all models (regardless of config) */
export function getAllModels(config?: Config): ResolvedModel[] {
  const registry = buildRegistry(config);
  return registry.flatMap(p => p.models);
}

/** Get provider by ID */
export function getProvider(providerId: string, config?: Config): ResolvedProvider | undefined {
  const registry = buildRegistry(config);
  return registry.find(p => p.id === providerId);
}

/** Get model by ref (providerId/modelId) */
export function getModel(ref: string, config?: Config): ResolvedModel | undefined {
  const [providerId, modelId] = ref.split('/');
  const provider = getProvider(providerId, config);
  return provider?.models.find(m => m.id === modelId);
}

// ============================================
// Backward compatibility functions (for existing code)
// ============================================

/** Check if provider is configured (has API key or OAuth) */
export function isProviderConfigured(config: Config | undefined, providerId: string): boolean {
  const provider = getProvider(providerId, config);
  return provider?.configured ?? false;
}

/** Get all provider IDs */
export function getAllProviderIds(config?: Config): string[] {
  const registry = buildRegistry(config);
  return registry.map(p => p.id);
}

/** Get configured provider IDs */
export function getConfiguredProviderIds(config?: Config): string[] {
  const registry = buildRegistry(config);
  return registry.filter(p => p.configured).map(p => p.id);
}

/** Check if model supports a specific feature */
export function modelSupportsFeature(modelRef: string, feature: string, config?: Config): boolean {
  const model = getModel(modelRef, config);
  if (!model) return false;
  
  switch (feature) {
    case 'vision':
      return model.input.includes('image');
    case 'reasoning':
      return model.reasoning;
    case 'streaming':
      const provider = getProvider(model.provider, config);
      return provider?.capabilities.streaming ?? false;
    default:
      return false;
  }
}

/** Check if model supports a specific modality */
export function modelSupportsModality(modelRef: string, modality: 'text' | 'image', config?: Config): boolean {
  const model = getModel(modelRef, config);
  if (!model) return false;
  
  return model.input.includes(modality);
}
