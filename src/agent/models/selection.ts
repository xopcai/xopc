/**
 * Model Selection
 * 
 * Handles model reference parsing and provider normalization.
 */

import type { ModelDefinitionConfig, ModelProviderConfig } from '../../config/types.models.js';

export interface ModelRef {
  provider: string;
  model: string;
}

/**
 * Normalize provider ID (handle aliases)
 */
export function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  // Alias mappings
  if (normalized === 'z.ai' || normalized === 'z-ai') {
    return 'zai';
  }
  if (normalized === 'opencode-zen') {
    return 'opencode';
  }
  if (normalized === 'qwen') {
    return 'qwen-portal';
  }
  if (normalized === 'kimi-code') {
    return 'kimi-coding';
  }
  // Backward compatibility for older provider naming
  if (normalized === 'bytedance' || normalized === 'doubao') {
    return 'volcengine';
  }
  return normalized;
}

/**
 * Parse a model reference string (e.g., "anthropic/claude-opus-4-6")
 * into provider and model parts.
 */
export function parseModelRef(ref: string, defaultProvider?: string): ModelRef | null {
  if (!ref || typeof ref !== 'string') {
    return null;
  }

  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    // No slash - treat entire string as model, use default provider
    const model = trimmed;
    const provider = defaultProvider || 'openai';
    return { provider, model };
  }

  const provider = trimmed.slice(0, slashIndex);
  const model = trimmed.slice(slashIndex + 1);

  if (!provider || !model) {
    return null;
  }

  return { provider: normalizeProviderId(provider), model };
}

/**
 * Find provider config by normalized provider ID
 */
export function findProviderConfig(
  providers: Record<string, ModelProviderConfig> | undefined,
  provider: string,
): ModelProviderConfig | undefined {
  if (!providers) {
    return undefined;
  }

  const normalizedProviderId = normalizeProviderId(provider);
  
  // Try exact match first
  if (providers[normalizedProviderId]) {
    return providers[normalizedProviderId];
  }

  // Try normalized match
  for (const [key, config] of Object.entries(providers)) {
    if (normalizeProviderId(key) === normalizedProviderId) {
      return config;
    }
  }

  return undefined;
}

/**
 * Find model config within a provider
 */
export function findModelConfig(
  provider: ModelProviderConfig,
  modelId: string,
): ModelDefinitionConfig | undefined {
  const normalizedModelId = modelId.toLowerCase();
  
  return provider.models.find(
    (m) => m.id.toLowerCase() === normalizedModelId,
  );
}
