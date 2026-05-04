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

const settingsSectionHeaderIconShellClass =
  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover/90 text-fg-muted transition-colors dark:bg-surface-hover/70';

export function SettingsFormSectionHeader({
  icon: Icon,
  title,
  subtitle,
  trailing,
  className,
  iconInteractive,
  iconLeading,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Optional content rendered at the trailing (right) edge of the header. */
  trailing?: ReactNode;
  className?: string;
  /** When set, the leading icon is a button (e.g. open a related settings dialog). */
  iconInteractive?: { onClick: () => void; ariaLabel: string; id?: string };
  /** When set, replaces the default Lucide icon in the leading slot (same size as the icon box). */
  iconLeading?: ReactNode;
}) {
  const defaultGlyph = <Icon className="size-4" strokeWidth={1.75} aria-hidden />;
  const lead = iconLeading ?? defaultGlyph;

  const leadingInteractiveClass = iconLeading
    ? cn(
        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-panel p-0 ring-1 ring-inset ring-edge-subtle transition-[box-shadow] hover:ring-accent/40 dark:ring-edge-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
      )
    : cn(
        settingsSectionHeaderIconShellClass,
        'hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
      );

  return (
    <div className={cn('mb-5 flex items-start gap-3', className)}>
      {iconInteractive ? (
        <button
          type="button"
          id={iconInteractive.id}
          onClick={iconInteractive.onClick}
          aria-label={iconInteractive.ariaLabel}
          className={leadingInteractiveClass}
        >
          {lead}
        </button>
      ) : (
        <div
          className={cn(
            iconLeading
              ? 'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-panel ring-1 ring-inset ring-edge-subtle dark:ring-edge-subtle'
              : settingsSectionHeaderIconShellClass,
          )}
          aria-hidden={!iconLeading}
        >
          {lead}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
