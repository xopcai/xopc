import type { ModelThinkingCapabilities } from '@xopcai/gateway-contract';
import type {
  ExternalRuntimeCommand,
  ExternalRuntimeRateLimits,
  ExternalRuntimeServiceTier,
} from '@/features/settings/types/agent-gateway';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import { apiUrl } from '@/lib/url';

export type ConfiguredModel = {
  id: string;
  name: string;
  displayNames?: Partial<Record<'zh-CN' | 'en', string>>;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinking?: ModelThinkingCapabilities;
  serviceTiers?: ExternalRuntimeServiceTier[];
  vision?: boolean;
  computerUse?: { dedicated?: boolean; profile: 'gui-plus-2026-02-26' | 'structured-tools-v1' | 'openai-responses-computer-v1' };
  phoneUse?: { profile: 'autoglm-phone-v1' | 'structured-phone-v1' | 'structured-tools-phone-v1' | 'doubao-seed-phone-v1' | 'gui-owl-phone-v1'; dedicated?: boolean };
  recommended?: boolean;
};

async function fetchConfiguredModels(): Promise<ConfiguredModel[]> {
  const res = await apiFetchWithStartupRetry(apiUrl('/api/models'));
  if (!res.ok) throw new Error(`Models: HTTP ${res.status}`);
  const data = (await res.json()) as { payload?: { models?: ConfiguredModel[] } };
  return data.payload?.models ?? [];
}

// Module-level cache for fetchConfiguredModels to prevent duplicate requests
let _modelsCache: ConfiguredModel[] | null = null;
let _modelsCacheExpiry = 0;
let _modelsInflight: Promise<ConfiguredModel[]> | null = null;
let _modelsCacheGen = 0;

const MODELS_CACHE_TTL_MS = 60_000; // 60 seconds

/** SWR key used by ModelSelector and other consumers. */
export const CONFIGURED_MODELS_SWR_KEY = 'gateway-configured-models';

/**
 * Invalidate the module-level models cache so the next fetch hits the server.
 * Also revalidates the SWR key so any mounted `useSWR` hook re-renders.
 */
export async function invalidateConfiguredModelsCache(): Promise<void> {
  _modelsCacheGen += 1;
  _modelsCache = null;
  _modelsCacheExpiry = 0;
  _modelsInflight = null;
  // Lazy import to avoid circular deps; mutate is a standalone SWR util.
  const { mutate } = await import('swr');
  await mutate(CONFIGURED_MODELS_SWR_KEY);
}

/**
 * Fetch configured models with caching and request deduplication.
 * All callers share the same cache within the TTL period.
 */
export async function fetchConfiguredModelsCached(forceRefresh = false): Promise<ConfiguredModel[]> {
  const now = Date.now();
  if (!forceRefresh && _modelsCache && now < _modelsCacheExpiry) {
    return _modelsCache;
  }
  const gen = _modelsCacheGen;
  // Bypass shared in-flight dedupe so callers that pass `true` always get a fresh list (e.g. onboarding).
  if (forceRefresh) {
    const models = await fetchConfiguredModels();
    if (gen === _modelsCacheGen) {
      _modelsCache = models;
      _modelsCacheExpiry = Date.now() + MODELS_CACHE_TTL_MS;
    }
    return models;
  }
  if (_modelsInflight) return _modelsInflight;

  const pending = fetchConfiguredModels()
    .then((models) => {
      if (gen === _modelsCacheGen) {
        _modelsCache = models;
        _modelsCacheExpiry = Date.now() + MODELS_CACHE_TTL_MS;
      }
      return models;
    })
    .finally(() => {
      if (_modelsInflight === pending) _modelsInflight = null;
    });
  _modelsInflight = pending;

  return pending;
}

export type ExternalAgentRuntimeModelsPayload = {
  runtimeKind: string;
  runtimeLabel: string;
  status: string;
  defaultModel: string;
  models: ConfiguredModel[];
  rateLimits?: ExternalRuntimeRateLimits;
  commands?: ExternalRuntimeCommand[];
  supportsCompact?: boolean;
  supportsFork?: boolean;
  supportsRollback?: boolean;
  message?: string;
};

const _externalModelsCache = new Map<string, { payload: ExternalAgentRuntimeModelsPayload; expiresAt: number }>();
const _externalModelsInflight = new Map<string, Promise<ExternalAgentRuntimeModelsPayload>>();
let _externalModelsCacheGen = 0;

export function agentRuntimeModelsSwrKey(agentId: string): readonly [string, string] {
  return ['gateway-agent-runtime-models', agentId] as const;
}

export async function invalidateAgentRuntimeModelsCache(agentId?: string): Promise<void> {
  _externalModelsCacheGen += 1;
  const { mutate } = await import('swr');
  if (agentId) {
    _externalModelsCache.delete(agentId);
    _externalModelsInflight.delete(agentId);
    await mutate(agentRuntimeModelsSwrKey(agentId));
    return;
  }
  _externalModelsCache.clear();
  _externalModelsInflight.clear();
  await mutate((key) => Array.isArray(key) && key[0] === 'gateway-agent-runtime-models');
}

async function fetchAgentRuntimeModels(agentId: string, forceRefresh = false): Promise<ExternalAgentRuntimeModelsPayload> {
  const qs = forceRefresh ? '?refresh=1' : '';
  const res = await apiFetchWithStartupRetry(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/runtime-models${qs}`));
  if (!res.ok) throw new Error(`Runtime models: HTTP ${res.status}`);
  const data = (await res.json()) as { payload?: ExternalAgentRuntimeModelsPayload };
  if (!data.payload) throw new Error('Missing runtime models payload');
  return data.payload;
}

export async function fetchAgentRuntimeModelsCached(
  agentId: string,
  forceRefresh = false,
): Promise<ExternalAgentRuntimeModelsPayload> {
  const now = Date.now();
  const cached = _externalModelsCache.get(agentId);
  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached.payload;
  }
  const gen = _externalModelsCacheGen;
  if (forceRefresh) {
    const payload = await fetchAgentRuntimeModels(agentId, true);
    if (gen === _externalModelsCacheGen) {
      _externalModelsCache.set(agentId, { payload, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
    }
    return payload;
  }
  const inflight = _externalModelsInflight.get(agentId);
  if (inflight) return inflight;

  const pending = fetchAgentRuntimeModels(agentId, false)
    .then((payload) => {
      if (gen === _externalModelsCacheGen) {
        _externalModelsCache.set(agentId, { payload, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
      }
      return payload;
    })
    .finally(() => {
      if (_externalModelsInflight.get(agentId) === pending) {
        _externalModelsInflight.delete(agentId);
      }
    });
  _externalModelsInflight.set(agentId, pending);
  return pending;
}
