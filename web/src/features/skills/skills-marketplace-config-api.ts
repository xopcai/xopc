import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SkillsMarketplaceConfigState = {
  provider: string;
  storeBaseUrl: string;
};

export const DEFAULT_SKILLS_MARKETPLACE: SkillsMarketplaceConfigState = {
  provider: 'skillhub',
  storeBaseUrl: 'https://store.xopc.ai',
};

const KNOWN_PROVIDERS = ['store', 'skillhub', 'clawhub'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeSkillsMarketplaceFromConfig(config: unknown): SkillsMarketplaceConfigState {
  const c = isRecord(config) ? config : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const providerRaw =
    typeof gw.skillsMarketplaceProvider === 'string' ? gw.skillsMarketplaceProvider.trim().toLowerCase() : '';
  const provider = KNOWN_PROVIDERS.includes(providerRaw as (typeof KNOWN_PROVIDERS)[number])
    ? providerRaw
    : providerRaw || DEFAULT_SKILLS_MARKETPLACE.provider;
  return {
    provider,
    storeBaseUrl:
      typeof gw.skillsStoreBaseUrl === 'string' && gw.skillsStoreBaseUrl.trim()
        ? gw.skillsStoreBaseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_SKILLS_MARKETPLACE.storeBaseUrl,
  };
}

export async function patchSkillsMarketplaceConfig(state: SkillsMarketplaceConfigState): Promise<void> {
  const url = state.storeBaseUrl.trim().replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Store base URL must start with http:// or https://');
  }

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        skillsMarketplaceProvider: state.provider.trim(),
        skillsStoreBaseUrl: url,
      },
    }),
  });
  void revalidateGatewayConfig();
}

export function listKnownMarketplaceProviders(): readonly string[] {
  return KNOWN_PROVIDERS;
}
