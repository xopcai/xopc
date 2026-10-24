import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { SettingsAiSetupAction, type SettingsAiSetupTarget } from './settings-ai-setup-action';

export function SettingsPageHeader({
  title,
  subtitle,
  docsLink,
  docsLabel,
  meta,
  actions,
  aiSetup,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  docsLink?: string;
  docsLabel?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  aiSetup?: SettingsAiSetupTarget;
  className?: string;
}) {
  return (
    <header
      className={cn(
        aiSetup
          ? 'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3'
          : 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-lg text-fg">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm leading-relaxed text-fg-muted sm:mt-1">{subtitle}</p>
        ) : null}
        {docsLink && docsLabel ? (
          <a
            href={docsLink}
            target="_blank"
            rel="noreferrer"
            className="touch-target mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {docsLabel}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        {meta}
      </div>
      {actions || aiSetup ? (
        <div className={cn('flex shrink-0 items-center gap-2', aiSetup ? 'min-w-0 max-w-[50vw] flex-col items-end sm:flex-row sm:justify-end' : 'flex-wrap justify-start sm:justify-end')}>
          {actions}
          {aiSetup && <SettingsAiSetupAction target={aiSetup} />}
        </div>
      ) : null}
    </header>
  );
}
