import type { AgentModelConfig, Config } from '../../config/schema.js';
import { getAgentDefaultModelRef, parseModelRef } from '../../config/schema.js';
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from '../../config/model-input.js';
import { getDefaultModelSync, isProviderConfiguredSync } from '../../providers/index.js';

export type ToolModelConfig = { primary?: string; fallbacks?: string[] };

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
  return { provider: 'anthropic', model: 'claude-sonnet-4-5' };
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
