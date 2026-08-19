import { hasProviderLogo } from '@/features/onboarding/provider-icons';
import type { ProviderMeta } from '@/features/settings/providers-api';

const XOPC_CLOUD_PROVIDER: ProviderMeta = {
  id: 'xopc-cloud',
  name: 'XOPC Cloud',
  category: 'common',
  supportsOAuth: true,
  supportsApiKey: false,
  configured: false,
  onboardingFeatured: true,
  hint: 'Connect your XOPC account. No API key required.',
};

const FALLBACK_FEATURED_PROVIDERS: ProviderMeta[] = [
  { id: 'deepseek', name: 'DeepSeek', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
  { id: 'openai', name: 'OpenAI', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
  { id: 'anthropic', name: 'Anthropic', category: 'common', supportsOAuth: true, supportsApiKey: true, configured: false, onboardingFeatured: true },
  { id: 'google', name: 'Google AI', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
];

const FEATURED_ORDER = new Map(
  [XOPC_CLOUD_PROVIDER, ...FALLBACK_FEATURED_PROVIDERS].map((provider, index) => [provider.id, index]),
);

export function resolveOnboardingProviders(
  providerMeta: ProviderMeta[] | undefined,
  desktop: boolean,
): ProviderMeta[] {
  const featured = providerMeta?.filter((provider) => (
    provider.onboardingFeatured && hasProviderLogo(provider.id)
  ));
  const source = featured?.length ? featured : FALLBACK_FEATURED_PROVIDERS;
  const providers = desktop
    ? [
        providerMeta?.find((provider) => provider.id === 'xopc-cloud') ?? XOPC_CLOUD_PROVIDER,
        ...source.filter((provider) => provider.id !== 'google' && provider.id !== 'xopc-cloud'),
      ]
    : source;
  return providers
    .slice()
    .sort((a, b) => (FEATURED_ORDER.get(a.id) ?? 999) - (FEATURED_ORDER.get(b.id) ?? 999));
}
