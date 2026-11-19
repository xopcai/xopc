import { ChevronRight } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export const CONNECTION_CARD_GRID_CLASS = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3';
export const CONNECTION_CARD_SURFACE_CLASS = 'flex min-h-[8.75rem] min-w-0 flex-col rounded-xl bg-surface-panel p-4';

export function ConnectionSummaryCard({ name, icon, status, description, action, highlighted, onOpen }: {
  name: string;
  icon: ReactNode;
  status: ReactNode;
  description?: string | null;
  action: string;
  highlighted?: boolean;
  onOpen: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={cn(
        CONNECTION_CARD_SURFACE_CLASS,
        'w-full text-left hover:bg-surface-panel-hover',
        interaction.transition,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        highlighted && 'bg-accent-soft',
      )}
      onClick={onOpen}
    >
      <span className="flex w-full min-w-0 items-start gap-3">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg" title={name}>{name}</span>
          {status}
        </span>
      </span>
      {description ? <span className="mt-2 w-full line-clamp-2 text-xs leading-5 text-fg-muted" title={description}>{description}</span> : null}
      <span className="mt-auto flex w-full items-center justify-end gap-1 pt-2 text-xs text-fg-muted">
        {action}
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      </span>
    </button>
  );
}
