import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  showLabel: string;
  hideLabel: string;
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
}: Props) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        'group rounded-2xl bg-surface-base open:pb-1',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-medium text-fg transition-colors hover:text-fg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180"
          aria-hidden
        />
        {Icon ? <Icon className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden /> : null}
        <span className="group-open:hidden">{showLabel}</span>
        <span className="hidden group-open:inline">{hideLabel}</span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
        {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}
