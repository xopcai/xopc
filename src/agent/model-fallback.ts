/**
 * Model Fallback
 * 
 * Handles automatic model fallback when a provider fails.
 */

import type { ModelDefinitionConfig, ModelsConfig } from '../config/types.models.js';
import { parseModelRef, normalizeProviderId } from './model-selection.js';

export interface FallbackCandidate {
  model: ModelDefinitionConfig;
  provider: string;
  reason: string;
  priority: number;
}

export interface FallbackOptions {
  /** Maximum number of fallback attempts */
  maxAttempts?: number;
  /** Prefer models with reasoning capability */
  preferReasoning?: boolean;
  /** Prefer cheaper models */
  preferCheaper?: boolean;
  /** Exclude specific provider IDs */
  excludeProviders?: string[];
}

/**
 * Default fallback options
 */
const DEFAULT_OPTIONS: Required<FallbackOptions> = {
  maxAttempts: 3,
  preferReasoning: false,
  preferCheaper: false,
  excludeProviders: [],
};

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  
  const errorStr = String(error).toLowerCase();
  
  // Rate limiting
  if (errorStr.includes('rate limit') || errorStr.includes('429')) {
    return true;
  }
  
  // Server errors
  if (errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503')) {
    return true;
  }
  
  // Timeout
  if (errorStr.includes('timeout') || errorStr.includes('etimedout')) {
    return true;
  }
  
  // Network errors
  if (errorStr.includes('network') || errorStr.includes('econnrefused')) {
    return true;
  }
  
  return false;
}

/**
 * Get fallback candidates for a failed model
 */
export function getFallbackCandidates(
  config: { models?: ModelsConfig },
  failedModelRef: string,
  options: FallbackOptions = {},
): FallbackCandidate[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Parse the failed model reference
  const failed = parseModelRef(failedModelRef);
  if (!failed) {
    return [];
  }
  
  const providers = config.models?.providers;
  if (!providers) {
    return [];
  }
  
  const candidates: FallbackCandidate[] = [];
  
  // Get all other models as potential fallbacks
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    // Skip excluded providers
    if (opts.excludeProviders.includes(normalizeProviderId(providerId))) {
      continue;
    }
    
    // Skip the same provider if it's the one that failed
    if (normalizeProviderId(providerId) === normalizeProviderId(failed.provider)) {
      continue;
    }
    
    for (const model of providerConfig.models || []) {
      const candidate = createCandidate(
        providerId,
        model,
        failed,
        opts,
      );
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  
  // Sort by priority
  candidates.sort((a, b) => {
    // First by priority (lower is better)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Then by cost if preferCheaper
    if (opts.preferCheaper) {
      const aCost = a.model.cost?.output ?? 0;
      const bCost = b.model.cost?.output ?? 0;
      return aCost - bCost;
    }
    return 0;
  });
  
  return candidates.slice(0, opts.maxAttempts);
}

/**
 * Create a fallback candidate from a model
 */
function createCandidate(
  providerId: string,
  model: ModelDefinitionConfig,
  failed: { provider: string; model: string },
  options: Required<FallbackOptions>,
): FallbackCandidate | null {
  let priority = 100;
  let reason = '';
  
  // Check if model has reasoning capability
  const hasReasoning = model.reasoning === true;
  if (options.preferReasoning && hasReasoning) {
    priority -= 50;
    reason = 'has reasoning capability';
  }
  
  // Check if model is from a different provider
  const providerNormalized = normalizeProviderId(providerId);
  if (providerNormalized !== failed.provider) {
    priority -= 10;
    reason = reason || 'different provider';
  }
  
  // Check model context window (prefer similar or larger)
  if (model.contextWindow && model.contextWindow >= 100000) {
    priority -= 5;
    reason = reason || 'large context window';
  }
  
  // Prefer models with larger context than the failed model
  if (model.contextWindow && model.contextWindow > 50000) {
    priority -= 3;
    reason = reason || 'adequate context window';
  }
  
  // Always return a candidate, even with low priority
  // This ensures we have fallback options even if none match preferences
  return {
    model,
    provider: providerId,
    reason: reason || 'available fallback',
    priority,
  };
}

/**
 * Select the best fallback model
 */
export function selectFallback(
  config: { models?: ModelsConfig },
  failedModelRef: string,
  options: FallbackOptions = {},
): FallbackCandidate | null {
  const candidates = getFallbackCandidates(config, failedModelRef, options);
  return candidates[0] ?? null;
}
