import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  showLabel: string;
  hideLabel: string;
  children: ReactNode;
  className?: string;
};

export function AgentDefaultsAdvancedDetails({ showLabel, hideLabel, children, className }: Props) {
  return (
    <details
      className={cn(
        'group rounded-lg border border-edge-subtle/80 bg-surface-hover/20 open:pb-3 dark:border-edge-subtle',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        <span className="group-open:hidden">{showLabel}</span>
        <span className="hidden group-open:inline">{hideLabel}</span>
      </summary>
      <div className="flex flex-col gap-5 px-3 pt-3">{children}</div>
    </details>
  );
}
