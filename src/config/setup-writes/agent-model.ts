import type { Config } from '../schema.js';

export interface AgentDefaultModelPatch {
  /** Model ref string or `{ primary, fallbacks? }` object. */
  model: string | { primary: string; fallbacks?: string[] };
  /** Optional fallbacks when `model` is a plain string. */
  fallbacks?: string[];
}

export function buildAgentDefaultModelField(
  patch: AgentDefaultModelPatch,
): string | { primary: string; fallbacks?: string[] } {
  if (typeof patch.model === 'object' && patch.model !== null && 'primary' in patch.model) {
    const primary = patch.model.primary.trim();
    const fallbacks = (patch.model.fallbacks ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    return fallbacks.length > 0 ? { primary, fallbacks } : primary;
  }

  const primary = String(patch.model).trim();
  const fallbacks = (patch.fallbacks ?? []).map((s) => s.trim()).filter(Boolean);
  return fallbacks.length > 0 ? { primary, fallbacks } : primary;
}

export function applyAgentDefaultModelPatch(cfg: Config, patch: AgentDefaultModelPatch): Config {
  const agents = { ...((cfg.agents ?? {}) as Record<string, unknown>) };
  const defaults = { ...((agents.defaults ?? {}) as Record<string, unknown>) };
  defaults.model = buildAgentDefaultModelField(patch);
  agents.defaults = defaults;
  return { ...cfg, agents } as Config;
}
