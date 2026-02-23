/**
 * Model Config Integration
 * 
 * Bridges the new OpenClaw-style model config with the existing provider system.
 * Ensures backward compatibility while enabling new features.
 */

import type { ModelsConfig, ModelProviderConfig, ModelDefinitionConfig } from './types.models.js';
import { applyModelDefaults } from './defaults.js';
import type { Config } from './schema.js';

/**
 * Get models config from main config
 */
export function getModelsConfig(config: Config): ModelsConfig | undefined {
  return config.models;
}

/**
 * Apply defaults to models config
 */
export function normalizeModelsConfig(config: { models?: ModelsConfig }): { models?: ModelsConfig } {
  return applyModelDefaults(config);
}

/**
 * Convert legacy providers config to new models config format
 * This provides backward compatibility
 */
export function migrateLegacyProviders(
  providers: Record<string, any>,
): Record<string, ModelProviderConfig> {
  const result: Record<string, ModelProviderConfig> = {};
  
  for (const [providerId, provider] of Object.entries(providers)) {
    // Skip if already in new format
    if (provider.models && provider.models[0]?.id) {
      result[providerId] = provider as ModelProviderConfig;
      continue;
    }
    
    // Convert from simple string array to model objects
    const baseUrl = provider.baseUrl || getDefaultBaseUrl(providerId);
    const models: ModelDefinitionConfig[] = (provider.models || []).map((modelId: string): ModelDefinitionConfig => ({
      id: modelId,
      name: modelId,
      reasoning: modelId.toLowerCase().includes('r1') || modelId.toLowerCase().includes('reasoning'),
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }));
    
    result[providerId] = {
      baseUrl,
      apiKey: provider.apiKey,
      api: provider.api,
      models,
    };
  }
  
  return result;
}

/**
 * Get default base URL for a provider
 */
function getDefaultBaseUrl(providerId: string): string {
  const defaults: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    google: 'https://generativelanguage.googleapis.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    kimi: 'https://api.moonshot.cn/v1',
    moonshot: 'https://api.moonshot.ai/v1',
    minimax: 'https://api.minimax.chat/v1',
    deepseek: 'https://api.deepseek.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    ollama: 'http://127.0.0.1:11434/v1',
  };
  
  return defaults[providerId.toLowerCase()] || '';
}

/**
 * Build effective models config by merging legacy and new configs
 */
export function buildEffectiveModelsConfig(config: Config): ModelsConfig {
  const newModels = config.models;
  const legacyProviders = config.providers;
  
  // If new models config exists, use it
  if (newModels?.providers && Object.keys(newModels.providers).length > 0) {
    const mode = newModels.mode || 'merge';
    
    if (mode === 'replace') {
      return newModels;
    }
    
    // Merge mode - combine with migrated legacy providers
    const migrated = migrateLegacyProviders(legacyProviders as Record<string, any>);
    const merged: Record<string, ModelProviderConfig> = { ...migrated };
    
    for (const [providerId, provider] of Object.entries(newModels.providers)) {
      if (merged[providerId]) {
        // Merge: new models add to existing provider
        merged[providerId] = {
          ...merged[providerId],
          ...provider,
          models: [...(merged[providerId].models || []), ...(provider.models || [])],
        };
      } else {
        merged[providerId] = provider;
      }
    }
    
    return {
      mode: 'merge',
      providers: merged,
      bedrockDiscovery: newModels.bedrockDiscovery,
    };
  }
  
  // No new config - migrate legacy only
  return {
    mode: 'replace',
    providers: migrateLegacyProviders(legacyProviders as Record<string, any>),
  };
}

/**
 * Get effective config with defaults applied
 */
export function getEffectiveConfig(config: Config): { models?: ModelsConfig } {
  const modelsConfig = buildEffectiveModelsConfig(config);
  return normalizeModelsConfig({ models: modelsConfig });
}
