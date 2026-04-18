import { ExternalLink, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import { getOrderedApiKeyLinks, providerApiKeyLinkLabel } from './provider-enrichment';

interface StarterProvider {
  id: string;
  reason: string;
  reasonZh: string;
}

const STARTER_PROVIDERS_EN: StarterProvider[] = [
  { id: 'openai', reason: 'Most popular, great all-rounder', reasonZh: '最流行，综合能力强' },
  { id: 'deepseek', reason: 'Affordable, strong reasoning', reasonZh: '价格低，推理能力强，国内可直连' },
  { id: 'anthropic', reason: 'Best for long documents & coding', reasonZh: '擅长长文档处理与代码' },
];

const STARTER_PROVIDERS_ZH: StarterProvider[] = [
  { id: 'openai', reason: 'Most popular, great all-rounder', reasonZh: '最流行，综合能力强' },
  { id: 'deepseek', reason: 'Affordable, strong reasoning', reasonZh: '价格低，推理能力强，国内可直连' },
  { id: 'qwen', reason: 'Domestic access, generous free tier', reasonZh: '国内直连，免费额度充足' },
];

interface OnboardingBannerProps {
  language: StoredLanguage;
  onDismiss: () => void;
  onScrollToProvider: (providerId: string) => void;
}

export function ProvidersOnboardingBanner({ language, onDismiss, onScrollToProvider }: OnboardingBannerProps) {
  const isZh = language === 'zh';
  const p = messages(language).providersSettings;
  const starters = isZh ? STARTER_PROVIDERS_ZH : STARTER_PROVIDERS_EN;

  return (
    <div className="rounded-2xl border border-edge bg-surface-base p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            {isZh ? '开始使用 — 选择一个服务商配置' : 'Get started — pick a provider to configure'}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {isZh
              ? '你需要至少一个 API Key 才能开始对话。以下是最容易上手的选项：'
              : 'You need at least one API key to start chatting. Here are the easiest options:'}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          aria-label={isZh ? '关闭' : 'Dismiss'}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {starters.map((starter) => {
          const keyLinks = getOrderedApiKeyLinks(starter.id, language);
          return (
            <div
              key={starter.id}
              className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-panel px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-fg">{starter.id}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{isZh ? starter.reasonZh : starter.reason}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 px-2 text-xs"
                  onClick={() => onScrollToProvider(starter.id)}
                >
                  {isZh ? '去配置 →' : 'Configure →'}
                </Button>
                {keyLinks.map((link) => (
                  <a
                    key={`${starter.id}-${link.kind}-${link.href}`}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs text-accent-fg hover:underline"
                  >
                    {providerApiKeyLinkLabel(link.kind, p)}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 text-xs text-fg-subtle hover:text-fg-muted hover:underline"
      >
        {isZh ? '暂时跳过' : 'Skip for now'}
      </button>
    </div>
  );
}
