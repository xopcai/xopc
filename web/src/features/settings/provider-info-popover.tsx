import * as Popover from '@radix-ui/react-popover';
import { ExternalLink, Info, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { ghostIconButton } from '@/lib/interaction';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';
import type { StoredLanguage } from '@/lib/storage';

import { PROVIDER_ENRICHMENT } from './provider-enrichment';

interface ProviderInfoPopoverProps {
  providerId: string;
  language: StoredLanguage;
}

export function ProviderInfoPopover({ providerId, language }: ProviderInfoPopoverProps) {
  const enrichment = PROVIDER_ENRICHMENT[providerId];
  if (!enrichment) return null;

  const isZh = language === 'zh';
  const description = isZh && enrichment.descriptionZh ? enrichment.descriptionZh : enrichment.description;
  if (!description) return null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(ghostIconButton, 'rounded p-0.5')}
          aria-label={isZh ? `${providerId} 详情` : `${providerId} info`}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={6}
          className={cn(
            'w-64 rounded-xl border border-edge bg-surface-panel p-3 shadow-md',
            SETTINGS_SHELL_POPOVER_Z,
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-fg">{providerId}</p>
            <Popover.Close asChild>
              <button
                type="button"
                className={cn(ghostIconButton, 'shrink-0 rounded p-0.5')}
                aria-label={isZh ? '关闭' : 'Close'}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </Popover.Close>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{description}</p>

          {enrichment.bestFor && enrichment.bestFor.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {isZh ? '适合场景' : 'Best for'}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {enrichment.bestFor.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-fg-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {enrichment.freeTier !== undefined ? (
            <div className="mt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {isZh ? '免费额度' : 'Free tier'}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {enrichment.freeTier
                  ? enrichment.freeTierNote ?? (isZh ? '有免费额度' : 'Available')
                  : isZh
                    ? '无免费额度（按量付费）'
                    : 'None (pay-as-you-go)'}
              </p>
            </div>
          ) : null}

          {enrichment.pricingUrl || enrichment.docsUrl ? (
            <div className="mt-2.5 flex gap-3">
              {enrichment.pricingUrl ? (
                <a
                  href={enrichment.pricingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs text-accent-fg hover:underline"
                >
                  {isZh ? '定价' : 'Pricing'}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
              {enrichment.docsUrl ? (
                <a
                  href={enrichment.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs text-accent-fg hover:underline"
                >
                  {isZh ? '文档' : 'Docs'}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          ) : null}

          <Popover.Arrow className="fill-edge" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
