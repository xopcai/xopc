import useSWR from 'swr';

import { cn } from '@/lib/cn';

import { hasProviderLogo, ProviderLogo } from '@/features/onboarding/provider-icons';
import { fetchProviderMetaList, type ProviderMeta } from '@/features/settings/providers-api';
import { messages } from '@/i18n/messages';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';

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
  [XOPC_CLOUD_PROVIDER, ...FALLBACK_FEATURED_PROVIDERS].map((p, index) => [p.id, index]),
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

function providerSubtitle(provider: ProviderMeta): string | undefined {
  const recommended = provider.recommendedModels?.map((m) => m.name || m.id).filter(Boolean).slice(0, 2);
  if (recommended?.length) return recommended.join(', ');
  return provider.hint;
}

export function OnboardingProviderGrid({
  onSelect,
}: {
  onSelect: (providerId: string) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const recommendedLabel = messages(language).onboarding.providerRecommended;
  const { data } = useSWR('onboarding-provider-meta', fetchProviderMetaList, {
    revalidateOnFocus: false,
  });

  const providers = resolveOnboardingProviders(data, isElectron());

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {providers.map((p, index) => {
        const subtitle = providerSubtitle(p);
        const recommended = index === 0;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              'relative flex min-h-32 flex-col items-center gap-1.5 rounded-xl border border-edge p-4 text-center transition-colors',
              'hover:border-accent hover:bg-accent-soft',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              recommended && 'border-accent/50 bg-accent-soft/30',
            )}
          >
            {recommended && (
              <span className="absolute -top-2 right-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
                {recommendedLabel}
              </span>
            )}
            <ProviderLogo providerId={p.id} className="size-8" />
            <span className="text-sm font-medium text-fg">{p.name}</span>
            {subtitle ? <span className="line-clamp-2 text-xs text-fg-muted">{subtitle}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
