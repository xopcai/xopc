import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function SettingsPageHeader({
  title,
  subtitle,
  docsLink,
  docsLabel,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  docsLink?: string;
  docsLabel?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
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
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
