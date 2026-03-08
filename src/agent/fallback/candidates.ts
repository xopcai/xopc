import type { Config } from '../../config/schema.js';
import { isProviderConfigured } from '../../providers/models-loader.js';

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

// Re-export for backward compatibility
export { isProviderConfigured };

/**
 * Check if a provider is configured (has API key in config or environment variable)
 * or is explicitly defined in config (even without apiKey)
 */
export function isProviderConfiguredWrapper(cfg: Config | undefined, provider: string): boolean {
  // Use the new loader function
  if (isProviderConfigured(cfg, provider)) return true;

  // Ollama special case - check baseUrl
  if (provider === 'ollama') {
    return !!cfg?.models?.providers?.[provider]?.baseUrl;
  }

  return false;
}

function parseModelRef(raw: string, defaultProvider?: string): ModelCandidate | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return defaultProvider ? { provider: defaultProvider, model: trimmed } : null;
  }

  const provider = trimmed.slice(0, slashIndex).trim();
  const model = trimmed.slice(slashIndex + 1).trim();
  return provider && model ? { provider, model } : null;
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

  const primaryResolved = parseModelRef(primaryRef ?? 'anthropic/claude-sonnet-4-5');
  const provider = inputProvider.trim() || primaryResolved?.provider || 'anthropic';
  const model = inputModel.trim() || primaryResolved?.model || 'claude-sonnet-4-5';

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
