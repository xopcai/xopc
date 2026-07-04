import { ExternalLink, type LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export type SettingsTabItem<T extends string> = {
  id: T;
  label: string;
  hint?: string;
  icon?: LucideIcon;
};

export function SettingsPageFrame({
  children,
  className,
  gap = 'gap-4',
  padding = 'px-4 py-6',
  ...props
}: {
  children: ReactNode;
  className?: string;
  gap?: string;
  padding?: string;
} & ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('mx-auto flex w-full max-w-app-main flex-col', gap, padding, className)} {...props}>
      {children}
    </div>
  );
}

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
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
        {docsLink && docsLabel ? (
          <a
            href={docsLink}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {docsLabel}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        {meta}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function SettingsTabs<T extends string>({
  items,
  activeTab,
  onChange,
  ariaLabel,
  tabIdPrefix,
  panelIdPrefix,
}: {
  items: readonly SettingsTabItem<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  ariaLabel: string;
  tabIdPrefix: string;
  panelIdPrefix: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      role="tablist"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const currentIndex = items.findIndex((item) => item.id === activeTab);
        if (currentIndex < 0) return;
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (currentIndex + delta + items.length) % items.length;
        onChange(items[nextIndex].id);
      }}
    >
      {items.map(({ id, icon: Icon, label }) => {
        const selected = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`${tabIdPrefix}-${id}`}
            aria-controls={`${panelIdPrefix}-${id}`}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              interaction.press,
              selected ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
            onClick={() => onChange(id)}
          >
            {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden /> : null}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SettingsTabPanel<T extends string>({
  id,
  activeTab,
  tabIdPrefix,
  panelIdPrefix,
  title,
  hint,
  showHeading = true,
  framed = true,
  children,
  className,
}: {
  id: T;
  activeTab: T;
  tabIdPrefix: string;
  panelIdPrefix: string;
  title?: ReactNode;
  hint?: ReactNode;
  showHeading?: boolean;
  framed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (activeTab !== id) return null;

  return (
    <section
      id={`${panelIdPrefix}-${id}`}
      role="tabpanel"
      aria-labelledby={`${tabIdPrefix}-${id}`}
      className={cn(
        'min-w-0',
        framed && 'rounded-2xl border border-edge bg-surface-base px-4 py-5 sm:px-5',
        className,
      )}
    >
      {showHeading && (title || hint) ? (
        <div className="mb-5">
          {title ? <div className="text-sm font-semibold text-fg">{title}</div> : null}
          {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
