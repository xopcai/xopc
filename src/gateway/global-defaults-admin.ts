import {
  CapabilityPresetSchema,
  DEFAULT_CAPABILITY_PRESET_ID,
  type CapabilityPreset,
} from '../agent-manifest/schema.js';
import type { Config } from '../config/schema.js';
import {
  getAllProviders,
  getModelsByProvider,
  getProviderAuthState,
  getProviderDisplayName,
} from '../providers/index.js';
import { getRecommendedModelsForProvider } from '../providers/presentation.js';

export type GlobalDefaultsProviderSource = 'config' | 'env' | 'oauth' | 'extension' | 'models_json' | 'agent' | null;

export type GlobalDefaultsProviderRow = {
  id: string;
  name: string;
  configured: boolean;
  source: GlobalDefaultsProviderSource;
};

export type GlobalDefaultsRecommendation = {
  provider: string;
  model: string;
  reason: 'configured-provider' | 'recommended';
};

export type GlobalDefaultsPayload = {
  presetId: string;
  models: NonNullable<CapabilityPreset['models']>;
  providers: GlobalDefaultsProviderRow[];
  recommendations: GlobalDefaultsRecommendation[];
};

export type UpdateGlobalDefaultsBody = {
  models?: CapabilityPreset['models'];
};

export type GlobalDefaultsAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: 400 | 404 | 500 };

function defaultPresetId(cfg: Config): string {
  return cfg.agents.defaultPreset || DEFAULT_CAPABILITY_PRESET_ID;
}

function emptyGlobalDefaultsPreset(id: string): CapabilityPreset {
  return {
    id,
    name: 'Global defaults',
    description: 'Default capabilities inherited by every agent.',
    version: 1,
    models: {
      defaultRole: 'deep',
      roles: {},
    },
  };
}

export function ensureGlobalDefaultsConfig(cfg: Config): Config {
  const presetId = defaultPresetId(cfg);
  const current = cfg.agents.capabilityPresets[presetId];
  const preset = current
    ? {
        ...current,
        id: presetId,
        name: current.name || 'Global defaults',
        version: current.version || 1,
        models: current.models ?? { defaultRole: 'deep', roles: {} },
      }
    : emptyGlobalDefaultsPreset(presetId);

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaultPreset: presetId,
      capabilityPresets: {
        ...cfg.agents.capabilityPresets,
        [presetId]: preset,
      },
    },
  };
}

function sourceFromAuthMode(authMode: string): GlobalDefaultsProviderSource {
  if (authMode === 'gateway') return 'config';
  if (authMode === 'env') return 'env';
  if (authMode === 'oauth') return 'oauth';
  if (authMode === 'extension') return 'extension';
  if (authMode === 'models_json') return 'models_json';
  if (authMode === 'agent') return 'agent';
  return null;
}

function recommendedModelForProvider(provider: string): string | null {
  const recommended = getRecommendedModelsForProvider(provider, 1)[0];
  if (recommended) return recommended.ref;
  const model = getModelsByProvider(provider)[0];
  return model ? `${provider}/${model.id}` : null;
}

export async function listGlobalDefaults(cfg: Config): Promise<GlobalDefaultsPayload> {
  const normalized = ensureGlobalDefaultsConfig(cfg);
  const presetId = defaultPresetId(normalized);
  const preset = normalized.agents.capabilityPresets[presetId] ?? emptyGlobalDefaultsPreset(presetId);
  const providers: GlobalDefaultsProviderRow[] = [];
  const recommendations: GlobalDefaultsRecommendation[] = [];

  for (const provider of getAllProviders()) {
    const auth = await getProviderAuthState(provider);
    const configured = auth.authStatus === 'connected';
    const source = configured ? sourceFromAuthMode(auth.authMode) : null;
    providers.push({
      id: provider,
      name: getProviderDisplayName(provider),
      configured,
      source,
    });
    if (configured) {
      const model = recommendedModelForProvider(provider);
      if (model) {
        recommendations.push({ provider, model, reason: 'configured-provider' });
      }
    }
  }

  providers.sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));

  return {
    presetId,
    models: preset.models ?? { defaultRole: 'deep', roles: {} },
    providers,
    recommendations,
  };
}

export function prepareUpdateGlobalDefaults(
  cfg: Config,
  body: UpdateGlobalDefaultsBody,
): GlobalDefaultsAdminResult<{ nextConfig: Config }> {
  const normalized = ensureGlobalDefaultsConfig(cfg);
  const presetId = defaultPresetId(normalized);
  const current = normalized.agents.capabilityPresets[presetId] ?? emptyGlobalDefaultsPreset(presetId);
  let nextPreset: CapabilityPreset = current;

  if (body.models !== undefined) {
    const parsed = CapabilityPresetSchema.pick({ models: true }).safeParse({ models: body.models });
    if (!parsed.success) {
      return { ok: false, error: `models ${parsed.error.issues[0]?.message ?? 'is invalid'}`, status: 400 };
    }
    const models = parsed.data.models ?? { defaultRole: 'deep', roles: {} };
    const roles = models.roles ?? {};
    const defaultRole = models.defaultRole ?? Object.keys(roles)[0] ?? 'deep';
    if (Object.keys(roles).length > 0 && !roles[defaultRole]) {
      return { ok: false, error: 'models.defaultRole must reference models.roles', status: 400 };
    }
    nextPreset = {
      ...nextPreset,
      models: { ...models, defaultRole, roles },
    };
  }

  return {
    ok: true,
    data: {
      nextConfig: {
        ...normalized,
        agents: {
          ...normalized.agents,
          capabilityPresets: {
            ...normalized.agents.capabilityPresets,
            [presetId]: nextPreset,
          },
        },
      },
    },
  };
}
