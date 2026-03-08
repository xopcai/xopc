/**
 * Registry client - simplified API client for models/providers.
 */

export interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  vision: boolean;
  cost: {
    input: number;
    output: number;
  };
  available: boolean;
}

export interface Provider {
  id: string;
  name: string;
  configured: boolean;
  models: Model[];
}

export type ProviderCategory = 'common' | 'specialty' | 'enterprise' | 'oauth';

export interface ProviderMeta {
  id: string;
  name: string;
  category: ProviderCategory;
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  configured: boolean;
}

export interface RegistryData {
  version: string;
  providers: Provider[];
}

export async function fetchRegistry(token?: string): Promise<RegistryData> {
  const response = await fetch(`${window.location.origin}/api/registry`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch registry: ${response.status}`);
  }

  const data = await response.json();
  return data.payload;
}

export async function fetchAllModels(token?: string): Promise<Model[]> {
  const response = await fetch(`${window.location.origin}/api/providers`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data = await response.json();
  return data.payload.models;
}

export async function fetchConfiguredModels(token?: string): Promise<Model[]> {
  const response = await fetch(`${window.location.origin}/api/models`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch configured models: ${response.status}`);
  }

  const data = await response.json();
  return data.payload.models;
}

export async function fetchProviders(token?: string): Promise<Provider[]> {
  const registry = await fetchRegistry(token);
  return registry.providers.sort((a, b) => {
    if (a.configured !== b.configured) {
      return a.configured ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

export async function fetchProviderMeta(token?: string): Promise<ProviderMeta[]> {
  const response = await fetch(`${window.location.origin}/api/providers/meta`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch provider meta: ${response.status}`);
  }

  const data = await response.json();
  return data.payload.providers;
}

export async function reloadRegistry(token?: string): Promise<void> {
  const response = await fetch(`${window.location.origin}/api/registry/reload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to reload registry: ${response.status}`);
  }
}

let _modelsCache: Model[] | null = null;
let _cacheExpiry: number = 0;
const CACHE_DURATION = 60000;

export async function fetchCachedModels(token?: string, forceRefresh = false): Promise<Model[]> {
  const now = Date.now();

  if (!forceRefresh && _modelsCache && now < _cacheExpiry) {
    return _modelsCache;
  }

  _modelsCache = await fetchConfiguredModels(token);
  _cacheExpiry = now + CACHE_DURATION;
  return _modelsCache;
}

export function clearRegistryCache(): void {
  _modelsCache = null;
  _cacheExpiry = 0;
}

/** @deprecated Use fetchAllModels instead */
export async function fetchProvidersLegacy(token?: string) {
  return fetchAllModels(token);
}

/** @deprecated Use fetchConfiguredModels instead */
export async function fetchConfiguredProviders(token?: string) {
  const models = await fetchConfiguredModels(token);
  const providers = new Map<string, Model[]>();
  models.forEach(m => {
    const list = providers.get(m.provider) || [];
    list.push(m);
    providers.set(m.provider, list);
  });
  return Array.from(providers.entries()).map(([id, models]) => ({
    id,
    name: id,
    configured: true,
    models,
  }));
}
