import type { AgentModelConfig, Config } from '../../config/schema.js';
import {
  getAgentDefaultImageModelConfig,
  getAgentDefaultModelRef,
  parseModelRef,
} from '../../config/schema.js';
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from '../../config/model-input.js';
import { getDefaultModelSync, getModelsByProvider, isProviderConfiguredSync } from '../../providers/index.js';

export type ToolModelConfig = {
  primary?: string;
  fallbacks?: string[];
  timeoutMs?: number;
  autoProviderFallback?: boolean;
};

export function hasToolModelConfig(model: ToolModelConfig | undefined): boolean {
  return Boolean(
    model?.primary?.trim() || (model?.fallbacks ?? []).some((entry) => entry.trim().length > 0),
  );
}

export function resolveDefaultModelRef(cfg?: Config): { provider: string; model: string } {
  const ref = cfg ? getAgentDefaultModelRef(cfg) : undefined;
  if (ref) {
    const p = parseModelRef(ref);
    if (p) {
      return p;
    }
  }
  const fallback = getDefaultModelSync(cfg);
  const p2 = parseModelRef(fallback);
  if (p2) {
    return p2;
  }
  return { provider: 'deepseek', model: 'deepseek-v4-flash' };
}

export function coerceToolModelConfig(model?: AgentModelConfig): ToolModelConfig {
  const primary = resolveAgentModelPrimaryValue(model);
  const fallbacks = resolveAgentModelFallbackValues(model);
  return {
    ...(primary?.trim() ? { primary: primary.trim() } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
}

export function buildToolModelConfigFromCandidates(params: {
  explicit: ToolModelConfig;
  candidates: Array<string | null | undefined>;
}): ToolModelConfig | null {
  if (hasToolModelConfig(params.explicit)) {
    return params.explicit;
  }

  const deduped: string[] = [];
  for (const candidate of params.candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || !trimmed.includes('/')) {
      continue;
    }
    const provider = trimmed.slice(0, trimmed.indexOf('/')).trim();
    if (!provider || !isProviderConfiguredSync(provider)) {
      continue;
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed);
    }
  }

  if (deduped.length === 0) {
    return null;
  }

  return {
    primary: deduped[0],
    ...(deduped.length > 1 ? { fallbacks: deduped.slice(1) } : {}),
  };
}

function firstVisionModelRef(provider: string): string | undefined {
  const m = getModelsByProvider(provider).find((x) => x.input?.includes('image'));
  return m ? `${provider}/${m.id}` : undefined;
}

/**
 * Effective image understanding model inferred from configured providers.
 */
export function resolveImageModelConfigForTool(params: { cfg?: Config }): ToolModelConfig | null {
  const explicit = coerceToolModelConfig(
    params.cfg ? getAgentDefaultImageModelConfig(params.cfg) : undefined,
  );
  if (hasToolModelConfig(explicit)) {
    return explicit;
  }

  const primary = resolveDefaultModelRef(params.cfg);
  const primaryCandidates: string[] = [];
  const vision = firstVisionModelRef(primary.provider);
  if (vision) {
    primaryCandidates.push(vision);
  }
  if (primary.provider === 'openai') {
    primaryCandidates.push('openai/gpt-5.6-luna');
  }
  if (primary.provider === 'anthropic') {
    primaryCandidates.push('anthropic/claude-sonnet-5');
  }
  if (primary.provider === 'google') {
    primaryCandidates.push('google/gemini-3.5-flash');
  }

  return buildToolModelConfigFromCandidates({
    explicit,
    candidates: [
      ...primaryCandidates,
      firstVisionModelRef('openai') ?? 'openai/gpt-5.6-luna',
      firstVisionModelRef('anthropic') ?? 'anthropic/claude-sonnet-5',
    ],
  });
}
