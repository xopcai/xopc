import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';

type Props = {
  label: string;
  description?: string;
  index: number;
  recommended?: boolean;
  recommendedLabel: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function ClarificationChoice({
  label,
  description,
  index,
  recommended,
  recommendedLabel,
  selected,
  disabled,
  onClick,
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={Boolean(selected)}
      className={cn(
        'group flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-hover/70 active:bg-surface-active/70',
      )}
    >
      {index < 9 ? (
        <span
          aria-hidden="true"
          className={cn(
            'hidden size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-medium tabular-nums sm:inline-flex',
            selected ? 'bg-accent/15 text-accent-fg' : 'bg-surface-panel/80 text-fg-subtle',
          )}
        >
          {index + 1}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 whitespace-normal break-words">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('font-medium leading-snug text-fg', selected && 'text-accent-fg')}>
            {label}
          </span>
          {recommended ? (
            <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium leading-none text-accent-fg">
              {recommendedLabel}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
          selected
            ? 'bg-accent text-on-accent'
            : 'border border-edge-strong/70 bg-surface-panel/60 group-hover:border-accent/50',
        )}
      >
        {selected ? <Check className="size-3 stroke-[2.5]" /> : null}
      </span>
    </button>
  );
}
