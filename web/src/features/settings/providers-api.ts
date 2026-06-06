import { type ConfiguredModel } from '@/features/chat/api/registry-api';
import { revalidateModelsHubCaches } from '@/features/settings/models-hub/models-hub-cache';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** True for gateway masked key sentinels (`***` or bullet placeholder). */
export function isMaskedKey(value: string): boolean {
  return value === '***' || value === '••••••••••••' || /^•+$/.test(value);
}

export type ProviderCategory = 'common' | 'specialty' | 'enterprise' | 'oauth' | 'extension';

export type ProviderActiveKeySource =
  | 'none'
  | 'agent'
  | 'gateway'
  | 'oauth'
  | 'env'
  | 'models_json'
  | 'extension';

export interface ProviderMeta {
  id: string;
  name: string;
  category: ProviderCategory;
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  configured: boolean;
  activeKeySource?: ProviderActiveKeySource;
  /** Effective LLM REST base URL (includes models.json overrides). */
  baseUrl?: string;
}

export interface ProviderRowModel extends ProviderMeta {
  apiKey: string;
}

export async function fetchProviderMetaList(): Promise<ProviderMeta[]> {
  const data = await fetchJson<{ ok?: boolean; payload?: { providers?: ProviderMeta[] } }>(
    apiUrl('/api/providers/meta'),
  );
  return data.payload?.providers ?? [];
}

export function providersKeysFromConfigRoot(config: unknown): Record<string, string> {
  if (!config || typeof config !== 'object' || !('providers' in config)) {
    return {};
  }
  const p = (config as { providers?: unknown }).providers;
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return {};
  }
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string') o[k] = v;
  }
  return o;
}

export function mergeProviderRows(
  meta: ProviderMeta[],
  configKeys: Record<string, string>,
  models: ConfiguredModel[],
): ProviderRowModel[] {
  const configuredFromModels = new Set(models.map((m) => m.provider));
  return meta.map((p) => ({
    ...p,
    configured: p.configured || configuredFromModels.has(p.id),
    apiKey: configKeys[p.id] || (p.configured || configuredFromModels.has(p.id) ? '••••••••••••' : ''),
  }));
}

export async function patchProviderApiKeys(providers: Record<string, string>): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ providers }),
  });
  await revalidateModelsHubCaches();
}

export async function deleteProviderApiKey(providerId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/providers/${encodeURIComponent(providerId)}/key`), {
    method: 'DELETE',
  });
  await revalidateModelsHubCaches();
}

export type RevealProviderApiKeyPayload = {
  id: string;
  apiKey: string | null;
  source: 'credential' | 'models_json' | 'none';
};

/** POST /api/providers/:id/reveal-api-key — gateway-stored or models.json key only. */
export async function revealProviderApiKey(providerId: string): Promise<RevealProviderApiKeyPayload> {
  const data = await fetchJson<{
    ok?: boolean;
    payload?: RevealProviderApiKeyPayload;
    error?: { message?: string };
  }>(apiUrl(`/api/providers/${encodeURIComponent(providerId)}/reveal-api-key`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!data.ok || !data.payload) {
    throw new Error(data.error?.message ?? 'Reveal failed');
  }
  return data.payload;
}

export type TestApiKeyResolutionPayload = {
  type: 'literal' | 'env' | 'command';
  resolved?: string;
  error?: string;
};

export async function testProviderKeyResolution(value: string): Promise<TestApiKeyResolutionPayload> {
  const data = await fetchJson<{ ok?: boolean; payload?: TestApiKeyResolutionPayload }>(
    apiUrl('/api/models-json/test-api-key'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
  );
  return data.payload ?? { type: 'literal', error: 'No response' };
}
