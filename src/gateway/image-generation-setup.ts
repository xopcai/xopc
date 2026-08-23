import {
  getImageGenerationProvider,
  listImageGenerationProvidersSummary,
} from '../agent/image/generation/provider-registry.js';
import { normalizeAgentId } from '../agent/agent-scope.js';
import { resolveEffectiveAgentManifestForAgent } from '../config/agent-profile.js';
import { ConfigSchema, type Config, type ProviderAuthConfig } from '../config/schema.js';
import { fetchWithTimeoutGuarded } from '../media-shared/http/index.js';

export type ImageGenerationSetupInput = {
  providerId: string;
  modelId?: string;
  providerConfig?: Record<string, unknown>;
};

export type ImageGenerationCatalogItem = ReturnType<typeof listImageGenerationProvidersSummary>[number] & {
  configured: boolean;
  config: Record<string, string>;
};

export function getImageGenerationCatalog(config: Config): ImageGenerationCatalogItem[] {
  return listImageGenerationProvidersSummary().map((summary) => {
    const provider = getImageGenerationProvider(summary.id)!;
    return {
      ...summary,
      configured: provider.isConfigured({ cfg: config }),
      config: Object.fromEntries(
        summary.configFields.flatMap((field) => {
          const value = config.providers?.[summary.id]?.[field.key];
          return typeof value === 'string' ? [[field.key, value]] : [];
        }),
      ),
    };
  });
}

function parseProviderConfig(
  provider: NonNullable<ReturnType<typeof getImageGenerationProvider>>,
  input: Record<string, unknown> | undefined,
): { ok: true; value: ProviderAuthConfig } | { ok: false; error: string } {
  const source = input ?? {};
  const allowedKeys = new Set(provider.configFields?.map((field) => field.key) ?? []);
  const unknownKey = Object.keys(source).find((key) => !allowedKeys.has(key as 'baseUrl' | 'region'));
  if (unknownKey) return { ok: false, error: `Unknown ${provider.id} config field: ${unknownKey}` };

  const value: ProviderAuthConfig = {};
  for (const field of provider.configFields ?? []) {
    const raw = source[field.key];
    const resolved = typeof raw === 'string' ? raw.trim() : '';
    if (!resolved) {
      if (field.required) return { ok: false, error: `${provider.id} requires ${field.key}` };
      continue;
    }
    if (field.type === 'select' && !field.options?.some((option) => option.value === resolved)) {
      return { ok: false, error: `Invalid ${provider.id} ${field.key}: ${resolved}` };
    }
    if (field.key === 'region') value.region = resolved as 'cn' | 'intl';
    else value.baseUrl = resolved;
  }
  return { ok: true, value };
}

export function getAgentImageGenerationConfig(config: Config, agentIdRaw: string) {
  const agentId = normalizeAgentId(agentIdRaw);
  if (!config.agents.list.some((entry) => entry.enabled !== false && normalizeAgentId(entry.id) === agentId)) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  const manifest = resolveEffectiveAgentManifestForAgent(config, agentId);
  return {
    agentId,
    model: manifest.models.imageGenerationModel ?? null,
  };
}

export function prepareImageGenerationSetup(
  config: Config,
  agentIdRaw: string,
  input: ImageGenerationSetupInput,
): { ok: true; config: Config; providerId: string; modelId: string } | { ok: false; error: string } {
  const agentId = normalizeAgentId(agentIdRaw);
  if (!config.agents.list.some((entry) => entry.enabled !== false && normalizeAgentId(entry.id) === agentId)) {
    return { ok: false, error: `Agent not found: ${agentId}` };
  }
  const providerId = input.providerId.trim();
  const provider = getImageGenerationProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown image provider: ${providerId}` };

  const modelId = input.modelId?.trim() || provider.defaultModel;
  if (!provider.models.includes(modelId)) {
    return { ok: false, error: `Unknown ${providerId} image model: ${modelId}` };
  }
  const parsedProviderConfig = parseProviderConfig(provider, input.providerConfig);
  if (parsedProviderConfig.ok === false) {
    return { ok: false, error: parsedProviderConfig.error };
  }

  const next = structuredClone(config);
  const index = next.agents.list.findIndex(
    (entry) => entry.enabled !== false && normalizeAgentId(entry.id) === agentId,
  );
  if (index < 0) return { ok: false, error: `Agent not found: ${agentId}` };

  next.providers = {
    ...(next.providers ?? {}),
    [providerId]: {
      ...(next.providers?.[providerId] ?? {}),
      ...parsedProviderConfig.value,
    },
  };
  const entry = next.agents.list[index]!;
  const models = entry.models ?? {
    defaultRole: resolveEffectiveAgentManifestForAgent(config, agentId).models.defaultRole,
    roles: {},
  };
  entry.models = {
    ...models,
    imageGenerationModel: { primary: `${providerId}/${modelId}` },
  };

  const parsed = ConfigSchema.safeParse(next);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  return { ok: true, config: next, providerId, modelId };
}

export async function verifyImageGenerationCredential(input: {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{ verified: boolean; supported: boolean; message?: string }> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) return { verified: false, supported: true, message: 'API key is required' };
  if (!getImageGenerationProvider(input.providerId)) {
    return {
      verified: false,
      supported: true,
      message: `Unknown image provider: ${input.providerId}`,
    };
  }

  let url: string;
  let headers: Record<string, string> = {};
  if (input.providerId === 'openai') {
    url = `${input.baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1'}/models`;
    headers = { Authorization: `Bearer ${apiKey}` };
  } else if (input.providerId === 'google') {
    const baseUrl = input.baseUrl?.trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
    url = `${baseUrl}/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  } else {
    return { verified: false, supported: false };
  }

  try {
    const response = await fetchWithTimeoutGuarded(url, {
      timeoutMs: 10_000,
      label: `${input.providerId} credential verification`,
      allowPrivateNetwork: false,
      init: { headers, redirect: 'error' },
    });
    if (response.ok) return { verified: true, supported: true };
    return {
      verified: false,
      supported: true,
      message: `Provider returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      verified: false,
      supported: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
