import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Settings content sits on `bg-surface-panel`; grouped blocks use a recessed `bg-surface-base`
 * lift instead of heavy borders (design system §2.1, §4.2).
 */
export function settingsFormSectionClassName(): string {
  return 'rounded-2xl bg-surface-base px-4 py-5 sm:px-5';
}

export function SettingsFormSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn(settingsFormSectionClassName(), className)}>{children}</section>;
}

export function SettingsFormSectionHeader({
  icon: Icon,
  title,
  subtitle,
  className,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex items-start gap-3', className)}>
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover/90 text-fg-muted dark:bg-surface-hover/70"
        aria-hidden
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
      </div>
    </div>
  );
}
