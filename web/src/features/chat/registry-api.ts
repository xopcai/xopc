import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ConfiguredModel = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
};

export async function fetchConfiguredModels(): Promise<ConfiguredModel[]> {
  const res = await apiFetch(apiUrl('/api/models'));
  if (!res.ok) throw new Error(`Models: HTTP ${res.status}`);
  const data = (await res.json()) as { payload?: { models?: ConfiguredModel[] } };
  return data.payload?.models ?? [];
}

// Module-level cache for fetchConfiguredModels to prevent duplicate requests
let _modelsCache: ConfiguredModel[] | null = null;
let _modelsCacheExpiry = 0;
let _modelsInflight: Promise<ConfiguredModel[]> | null = null;

const MODELS_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Fetch configured models with caching and request deduplication.
 * All callers share the same cache within the TTL period.
 */
export async function fetchConfiguredModelsCached(forceRefresh = false): Promise<ConfiguredModel[]> {
  const now = Date.now();
  if (!forceRefresh && _modelsCache && now < _modelsCacheExpiry) {
    return _modelsCache;
  }
  if (_modelsInflight) return _modelsInflight; // Deduplicate concurrent requests

  _modelsInflight = fetchConfiguredModels()
    .then((models) => {
      _modelsCache = models;
      _modelsCacheExpiry = Date.now() + MODELS_CACHE_TTL_MS;
      return models;
    })
    .finally(() => {
      _modelsInflight = null;
    });

  return _modelsInflight;
}
