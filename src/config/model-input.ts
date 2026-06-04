import type { AgentModelConfig } from './schema.js';

export function resolveAgentModelPrimaryValue(model?: AgentModelConfig): string | undefined {
  const primary = model?.primary?.trim();
  return primary || undefined;
}

export function resolveAgentModelFallbackValues(model?: AgentModelConfig): string[] {
  return Array.isArray(model?.fallbacks) ? model.fallbacks : [];
}
