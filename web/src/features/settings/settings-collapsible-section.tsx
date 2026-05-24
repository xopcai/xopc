import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  showLabel: string;
  hideLabel: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
};

export function SettingsCollapsibleSection({
  showLabel,
  hideLabel,
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
        <span className="group-open:hidden">{showLabel}</span>
        <span className="hidden group-open:inline">{hideLabel}</span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}
