import type { AgentModelConfig } from './schema.js';

export function resolveAgentModelPrimaryValue(model?: AgentModelConfig): string | undefined {
  if (typeof model === 'string') {
    const trimmed = model.trim();
    return trimmed || undefined;
  }
  if (!model || typeof model !== 'object') {
    return undefined;
  }
  const primary = model.primary?.trim();
  return primary || undefined;
}

export function resolveAgentModelFallbackValues(model?: AgentModelConfig): string[] {
  if (!model || typeof model !== 'object') {
    return [];
  }
  return Array.isArray(model.fallbacks) ? model.fallbacks : [];
}
