import { isMaskedSecret } from '@/lib/is-masked-secret';

/** Minimal config shape for deciding if the user must configure providers / default model. */
export type GatewayModelSetupConfig = {
  agents: {
    default?: string;
    list: Array<{
      id: string;
      models: {
        defaultRole: string;
        roles: Record<string, { model: string }>;
      };
    }>;
  };
  providers: Record<string, string>;
};

/**
 * True when no provider is configured and/or default model is missing (first-launch / unusable chat).
 * Safe for partial/malformed API payloads (never throws).
 */
export function needsModelOrProviders(config: unknown): boolean {
  if (!config || typeof config !== 'object') return true;
  const c = config as Record<string, unknown>;

  const rawProviders = c.providers;
  const providers =
    rawProviders && typeof rawProviders === 'object' && !Array.isArray(rawProviders)
      ? (rawProviders as Record<string, unknown>)
      : {};
  const hasProvider = Object.values(providers).some((v) => {
    if (typeof v === 'string') {
      return v.trim().length > 0 || isMaskedSecret(v);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const apiKey = (v as { apiKey?: unknown }).apiKey;
      return typeof apiKey === 'string' && (apiKey.trim().length > 0 || isMaskedSecret(apiKey));
    }
    return false;
  });

  const agents = c.agents;
  let model = '';
  if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
    const agentRoot = agents as Record<string, unknown>;
    const defaults = agentRoot.defaults;
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      const legacyModel = (defaults as { model?: unknown }).model;
      if (typeof legacyModel === 'string') model = legacyModel;
    }
    const list = Array.isArray(agentRoot.list) ? agentRoot.list : [];
    const defaultId = typeof agentRoot.default === 'string' && agentRoot.default.trim() ? agentRoot.default.trim() : '';
    const entry =
      list.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === defaultId) ??
      list.find((item) => item && typeof item === 'object');
    if (entry && typeof entry === 'object') {
      const models = (entry as { models?: unknown }).models;
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
  }
  const modelOk = model.trim().length > 0;
  return !hasProvider || !modelOk;
}
