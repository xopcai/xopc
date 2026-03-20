import type { Config } from '../../config/schema.js';
import { isProviderConfigured } from '../../config/schema.js';
import { getDefaultModelSync } from '../../providers/index.js';
import { parseModelRef as parseModelRefUtil, normalizeProviderId } from '../models/selection.js';

export interface ModelCandidate {
  provider: string;
  model: string;
}

export interface FallbackAttempt {
  provider: string;
  model: string;
  error: string;
  reason?: string;
  status?: number;
  code?: string;
}

// Re-export for backward compatibility (sync)
export { isProviderConfigured };

// Get default model dynamically
function getDefaultModelParts(config?: Config): { provider: string; model: string } {
  const defaultModel = getDefaultModelSync(config);
  const parts = defaultModel.split('/');
  return {
    provider: parts[0] || 'anthropic',
    model: parts[1] || 'claude-sonnet-4-5',
  };
}

/**
 * Parse model reference string into provider/model parts.
 * Uses the unified implementation from selection.ts.
 */
function parseModelRef(raw: string, defaultProvider?: string): ModelCandidate | null {
  const result = parseModelRefUtil(raw, defaultProvider);
  if (!result) return null;
  return {
    provider: normalizeProviderId(result.provider),
    model: result.model,
  };
}

export function resolveFallbackCandidates(params: {
  cfg: Config | undefined;
  provider: string;
  model: string;
  fallbacksOverride?: string[];
}): ModelCandidate[] {
  const { cfg, provider: inputProvider, model: inputModel, fallbacksOverride } = params;

  const modelConfig = cfg?.agents?.defaults?.model;
  const primaryRef = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
  const fallbacks = fallbacksOverride ?? (typeof modelConfig === 'object' ? modelConfig.fallbacks : undefined);

  const defaultParts = getDefaultModelParts(cfg);
  const primaryResolved = parseModelRef(primaryRef || getDefaultModelSync(cfg));
  const provider = inputProvider.trim() || primaryResolved?.provider || defaultParts.provider;
  const model = inputModel.trim() || primaryResolved?.model || defaultParts.model;

  const candidates: ModelCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (c: ModelCandidate) => {
    const key = `${c.provider}/${c.model}`.toLowerCase();
    if (seen.has(key)) return;
    // Skip providers that are not configured (no API key)
    if (!isProviderConfigured(cfg, c.provider)) return;
    seen.add(key);
    candidates.push(c);
  };

  addCandidate({ provider, model });

  if (fallbacks) {
    for (const fb of fallbacks) {
      const resolved = parseModelRef(fb, provider);
      if (resolved) addCandidate(resolved);
    }
  }

  if (!fallbacksOverride && primaryResolved) {
    addCandidate(primaryResolved);
  }

  return candidates;
}
