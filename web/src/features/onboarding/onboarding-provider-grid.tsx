import useSWR from 'swr';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

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
  const [showOthers, setShowOthers] = useState(false);
  const { data } = useSWR('onboarding-provider-meta', fetchProviderMetaList, {
    revalidateOnFocus: false,
  });

  const providers = resolveOnboardingProviders(data, isElectron());
  const recommended = providers[0];
  const others = providers.slice(1);

  return (
    <div>
      {recommended ? (
        <button
          type="button"
          onClick={() => onSelect(recommended.id)}
          className="group flex w-full items-center gap-4 rounded-2xl border border-accent/35 bg-accent-soft/55 p-4 text-left shadow-elevated transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transform-none"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-edge bg-surface-panel shadow-surface">
            <ProviderLogo providerId={recommended.id} className="size-8" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-fg">{recommended.name}</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">{recommendedLabel}</span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-fg-muted">{providerSubtitle(recommended)}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-accent-fg transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden />
        </button>
      ) : null}

      {others.length ? (
        <div className="mt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((value) => !value)}
          >
            {language === 'zh' ? '使用其他模型服务' : 'Use another model service'}
            <ChevronDown className={cn('size-4 transition-transform duration-200', showOthers && 'rotate-180')} aria-hidden />
          </button>
          {showOthers ? (
            <div className="xopc-onboarding-provider-options mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {others.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => onSelect(provider.id)}
                  className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-edge bg-surface-panel p-3 text-center transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transform-none"
                >
                  <ProviderLogo providerId={provider.id} className="size-7" />
                  <span className="text-xs font-medium text-fg">{provider.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
