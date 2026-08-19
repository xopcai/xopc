import useSWR from 'swr';

import { cn } from '@/lib/cn';

import { ProviderLogo } from '@/features/onboarding/provider-icons';
import { fetchProviderMetaList, type ProviderMeta } from '@/features/settings/providers-api';
import { messages } from '@/i18n/messages';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';

import { resolveOnboardingProviders } from './onboarding-provider-options';

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
