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
    list?: Array<{
      id?: string;
      enabled?: boolean;
      default?: boolean;
      extends?: string[];
      models?: {
        defaultRole?: string;
        roles?: Record<string, { model: string }>;
      };
    }>;
  };
};

type ModelPolicyLike = {
  defaultRole?: unknown;
  roles?: unknown;
};

function modelFromPolicy(models: unknown): string | undefined {
  if (!models || typeof models !== 'object' || Array.isArray(models)) return undefined;
  const policy = models as ModelPolicyLike;
  const roles = policy.roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return undefined;
  const defaultRole = typeof policy.defaultRole === 'string' && policy.defaultRole.trim()
    ? policy.defaultRole.trim()
    : Object.keys(roles)[0];
  if (!defaultRole) return undefined;
  const role = (roles as Record<string, unknown>)[defaultRole];
  if (!role || typeof role !== 'object' || Array.isArray(role)) return undefined;
  const model = (role as { model?: unknown }).model;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

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
    const presetMap = presets && typeof presets === 'object' && !Array.isArray(presets)
      ? presets as Record<string, unknown>
      : {};
    const applyPreset = (presetId: string) => {
      const preset = presetMap[presetId];
      if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return;
      const presetModel = modelFromPolicy((preset as Record<string, unknown>).models);
      if (presetModel) model = presetModel;
    };

    applyPreset(defaultPreset);

    const list = Array.isArray(agentRoot.list) ? agentRoot.list : [];
    const configuredDefaultAgentId = typeof agentRoot.default === 'string' ? agentRoot.default.trim() : '';
    const explicitDefault = list.find((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const record = entry as Record<string, unknown>;
      return record.enabled !== false && record.default === true;
    });
    const agent = list.find((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const record = entry as Record<string, unknown>;
      return record.enabled !== false && configuredDefaultAgentId && record.id === configuredDefaultAgentId;
    }) ?? explicitDefault ?? list.find((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      return (entry as Record<string, unknown>).enabled !== false;
    });

    if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
      const record = agent as Record<string, unknown>;
      const extendsList = Array.isArray(record.extends) ? record.extends : [];
      for (const presetId of extendsList) {
        if (typeof presetId === 'string' && presetId !== defaultPreset) {
          applyPreset(presetId);
        }
      }
      const agentModel = modelFromPolicy(record.models);
      if (agentModel) model = agentModel;
    }
  }
  const modelOk = model.trim().length > 0;
  return !modelOk;
}
