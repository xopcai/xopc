import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { fetchConfiguredModelsCached } from '@/features/chat/registry-api';

/** Matches GET /api/config masked keys and legacy UI placeholder */
export function isMaskedKey(value: string): boolean {
  return value === '***' || value === '••••••••••••';
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

export interface ProviderRowModel extends ProviderMeta {
  apiKey: string;
}

export async function fetchProviderMetaList(): Promise<ProviderMeta[]> {
  const data = await fetchJson<{ ok?: boolean; payload?: { providers?: ProviderMeta[] } }>(
    apiUrl('/api/providers/meta'),
  );
  return data.payload?.providers ?? [];
}

export async function fetchProvidersConfig(): Promise<Record<string, string>> {
  const data = await fetchJson<{ ok?: boolean; payload?: { config?: { providers?: Record<string, string> } } }>(
    apiUrl('/api/config'),
  );
  return data.payload?.config?.providers ?? {};
}

/** Merge meta with config keys and configured-model hints (matches Lit settings behavior). */
export async function loadProviderRows(): Promise<ProviderRowModel[]> {
  const [meta, configKeys, models] = await Promise.all([
    fetchProviderMetaList(),
    fetchProvidersConfig(),
    fetchConfiguredModelsCached(),
  ]);
  const configuredFromModels = new Set(models.map((m) => m.provider));
  return meta.map((p) => ({
    ...p,
    configured: p.configured || configuredFromModels.has(p.id),
    apiKey: configKeys[p.id] || (p.configured || configuredFromModels.has(p.id) ? '***' : ''),
  }));
}

export async function patchProviderApiKeys(providers: Record<string, string>): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ providers }),
  });
}
