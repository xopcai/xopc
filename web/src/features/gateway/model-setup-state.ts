/** Minimal config shape for deciding if the user must configure providers / default model. */
export type GatewayModelSetupConfig = {
  agents: {
    default?: string;
    defaultPreset?: string;
    capabilityPresets?: Record<
      string,
      {
        models?: {
          defaultRole?: string;
          roles?: Record<string, { model: string }>;
        };
      }
    >;
  };
};

/**
 * True when the global default model is missing (first-launch / unusable chat).
 * Safe for partial/malformed API payloads (never throws).
 */
export function needsModelOrProviders(config: unknown): boolean {
  if (!config || typeof config !== 'object') return true;
  const c = config as Record<string, unknown>;
  const agents = c.agents;
  let model = '';
  if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
    const agentRoot = agents as Record<string, unknown>;
    const defaultPreset = typeof agentRoot.defaultPreset === 'string' && agentRoot.defaultPreset.trim()
      ? agentRoot.defaultPreset.trim()
      : 'default';
    const presets = agentRoot.capabilityPresets;
    const preset = presets && typeof presets === 'object' && !Array.isArray(presets)
      ? (presets as Record<string, unknown>)[defaultPreset]
      : undefined;
    const models = preset && typeof preset === 'object' && !Array.isArray(preset)
      ? (preset as Record<string, unknown>).models
      : undefined;
    if (models && typeof models === 'object' && !Array.isArray(models)) {
      const defaultRole = (models as { defaultRole?: unknown }).defaultRole;
      const roles = (models as { roles?: unknown }).roles;
      if (typeof defaultRole === 'string' && roles && typeof roles === 'object' && !Array.isArray(roles)) {
        const role = (roles as Record<string, unknown>)[defaultRole];
        if (role && typeof role === 'object' && !Array.isArray(role)) {
          const m = (role as { model?: unknown }).model;
          if (typeof m === 'string') model = m;
        }
      }
    }
  }
  const modelOk = model.trim().length > 0;
  return !modelOk;
}
