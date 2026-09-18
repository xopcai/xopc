import useSWR from 'swr';
import { ChevronRight, KeyRound } from 'lucide-react';

import { ProviderLogo } from '@/features/onboarding/provider-icons';
import { fetchProviderMetaList, type ProviderMeta } from '@/features/settings/providers-api';
import { messages } from '@/i18n/messages';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';

import { resolveRecommendedOnboardingProvider } from './onboarding-provider-options';

function providerSubtitle(provider: ProviderMeta): string | undefined {
  const recommended = provider.recommendedModels?.map((m) => m.name || m.id).filter(Boolean).slice(0, 2);
  if (recommended?.length) return recommended.join(', ');
  return provider.hint;
}

export function OnboardingProviderGrid({
  onSelect,
  onBrowseProviders,
  disabled = false,
  browseDisabled = false,
}: {
  onSelect: (providerId: string) => void;
  onBrowseProviders: () => void;
  disabled?: boolean;
  browseDisabled?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const recommendedLabel = messages(language).onboarding.providerRecommended;
  const { data } = useSWR('onboarding-provider-meta', fetchProviderMetaList, {
    revalidateOnFocus: false,
  });

  const recommended = resolveRecommendedOnboardingProvider(data, isElectron());

  return (
    <div>
      {recommended ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(recommended.id)}
          className="group flex w-full items-center gap-3.5 rounded-xl border border-accent/30 bg-accent-soft/45 p-3.5 text-left transition-[border-color,background-color] duration-200 hover:border-accent/55 hover:bg-accent-soft/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-edge-subtle bg-surface-base/70">
            <ProviderLogo providerId={recommended.id} className="size-7" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-fg">{recommended.name}</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent">{recommendedLabel}</span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-fg-muted">{providerSubtitle(recommended)}</span>
          </span>
          <ChevronRight className="size-4.5 shrink-0 text-accent-fg/80" aria-hidden />
        </button>
      ) : null}

      <button
        type="button"
        disabled={disabled || browseDisabled}
        onClick={onBrowseProviders}
        className="mt-3 flex min-h-16 w-full items-center gap-3.5 rounded-xl border border-edge bg-surface-base/65 p-3.5 text-left transition-[border-color,background-color] duration-200 hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-edge-subtle bg-surface-panel text-fg-muted">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-fg">
            {language === 'zh' ? '连接我自己的模型服务' : 'Connect my own model service'}
          </span>
          <span className="mt-1 block text-xs leading-5 text-fg-muted">
            {browseDisabled && !disabled
              ? (language === 'zh' ? '正在加载可用的模型服务…' : 'Loading available model services…')
              : language === 'zh'
                ? '使用自己的账号、API Key、本地模型或私有接口。'
                : 'Use your own account, API key, local model, or private endpoint.'}
          </span>
        </span>
        <ChevronRight className="size-4.5 shrink-0 text-fg-subtle" aria-hidden />
      </button>
    </div>
  );
}
