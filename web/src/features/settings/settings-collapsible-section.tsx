import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { SettingsAdvancedGate } from '@/features/settings/settings-advanced-gate';
import { cn } from '@/lib/cn';

type Props = {
  showLabel: string;
  hideLabel: string;
  /** When true, the whole section is omitted in simple settings mode. */
  advancedOnly?: boolean;
  /** Optional decorative icon rendered between the chevron and the label. */
  icon?: LucideIcon;
  /** Optional muted hint shown under the summary while the section is open. */
  hint?: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
};

export function SettingsCollapsibleSection({
  showLabel,
  hideLabel,
  icon: Icon,
  hint,
  children,
  className,
  defaultOpen,
  advancedOnly = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  const section = (
    <section className={cn('rounded-2xl bg-surface-base', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-2xl px-4 py-3.5 text-left text-sm font-medium text-fg transition-colors hover:text-fg"
      >
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-fg-muted transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        {Icon ? <Icon className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden /> : null}
        <span>{open ? hideLabel : showLabel}</span>
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
            {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
            {children}
          </div>
        </div>
      </div>
    </section>
  );

  if (advancedOnly) {
    return <SettingsAdvancedGate>{section}</SettingsAdvancedGate>;
  }

  return section;
}
