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
          className="group flex w-full items-center gap-3.5 rounded-xl border border-accent/30 bg-accent-soft/45 p-3.5 text-left transition-[border-color,background-color] duration-200 hover:border-accent/55 hover:bg-accent-soft/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-edge-subtle bg-surface-base/70">
            <ProviderLogo providerId={recommended.id} className="size-7" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-fg">{recommended.name}</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">{recommendedLabel}</span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-fg-muted">{providerSubtitle(recommended)}</span>
          </span>
          <ChevronRight className="size-4.5 shrink-0 text-accent-fg/80" aria-hidden />
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
            <div className="xopc-onboarding-provider-options mt-3 grid gap-2 sm:grid-cols-2">
              {others.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => onSelect(provider.id)}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-edge bg-surface-base/65 px-3 py-2.5 text-left transition-[border-color,background-color] duration-200 hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-panel">
                    <ProviderLogo providerId={provider.id} className="size-5.5" />
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-medium text-fg">{provider.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
