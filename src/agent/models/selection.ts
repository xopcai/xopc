/**
 * Model Selection
 * 
 * Handles model reference parsing, provider normalization, and alias resolution.
 */

import { resolveModelAlias } from '../../config/defaults.js';
import type { ModelDefinitionConfig, ModelProviderConfig } from '../../config/types.models.js';

// ============================================
// Types
// ============================================

export interface ModelRef {
  provider: string;
  model: string;
}

export type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// ============================================
// Provider ID Normalization
// ============================================

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

// ============================================
// Model Reference Parsing
// ============================================

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
    const provider = defaultProvider || 'openai'; // Default to openai
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
 * Create a model key string (provider/model)
 */
export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/**
 * Resolve a model reference, handling aliases
 */
export function resolveModelRef(
  ref: string,
  defaultProvider?: string,
): ModelRef | null {
  // First, check if it's an alias
  const resolved = resolveModelAlias(ref);
  const modelRef = resolved || ref;
  
  return parseModelRef(modelRef, defaultProvider);
}

// ============================================
// Provider Lookup
// ============================================

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

/**
 * Get full model config from providers by model reference
 */
export function getModelConfig(
  providers: Record<string, ModelProviderConfig> | undefined,
  modelRef: string,
  defaultProvider?: string,
): { provider: ModelProviderConfig; model: ModelDefinitionConfig } | null {
  const ref = resolveModelRef(modelRef, defaultProvider);
  if (!ref) {
    return null;
  }

  const provider = findProviderConfig(providers, ref.provider);
  if (!provider) {
    return null;
  }

  const model = findModelConfig(provider, ref.model);
  if (!model) {
    return null;
  }

  return { provider, model };
}

// ============================================
// Provider Detection
// ============================================

/**
 * Detect provider from model ID based on known patterns
 */
export function detectProviderByModel(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  
  // Anthropic
  if (lower.includes('claude') || lower.startsWith('anthropic/')) {
    return 'anthropic';
  }
  
  // OpenAI
  if (lower.startsWith('gpt-') || lower.startsWith('openai/')) {
    return 'openai';
  }
  
  // Google
  if (lower.includes('gemini') || lower.startsWith('google/')) {
    return 'google';
  }
  
  // Ollama (local models typically don't have provider prefix)
  // This is a heuristic - check if it looks like a common Ollama model
  if (lower.includes(':') && !lower.includes('/')) {
    return 'ollama';
  }
  
  return null;
}

/**
 * Get all available model IDs from all providers
 */
export function getAllModelIds(
  providers: Record<string, ModelProviderConfig> | undefined,
): string[] {
  if (!providers) {
    return [];
  }

  const ids: string[] = [];
  for (const provider of Object.values(providers)) {
    for (const model of provider.models) {
      ids.push(modelKey(provider.baseUrl, model.id));
    }
  }
  return ids;
}
