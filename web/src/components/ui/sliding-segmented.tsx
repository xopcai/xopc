import type { LucideIcon } from 'lucide-react';
import { useRef } from 'react';

import { SlidingIndicator, useSlidingIndicator } from '@/components/ui/sliding-indicator';
import { segmentedTrackClassName } from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';

export type SlidingSegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Optional native tooltip (defaults to `label`). */
  title?: string;
  icon?: LucideIcon;
};

/**
 * Native control — avoids merging `Button` base (`py-2`, `text-sm`, `gap-2`, `active:scale-95`)
 * with segment classes, which was skewing vertical alignment inside the pill.
 */
const segmentButtonClassName =
  'touch-target relative z-[2] box-border flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-pill border-0 bg-transparent px-2 py-0 text-center text-xs font-medium leading-none outline-none transition-[color,background-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel active:scale-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Pill segmented control with a single sliding surface (thumb) behind the selected segment.
 * Matches ui-design-system segmented control; respects `prefers-reduced-motion`.
 */
export function SlidingSegmented<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  className,
  buttonClassName,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SlidingSegmentOption<T>[];
  'aria-label': string;
  className?: string;
  /** Extra classes for each segment button (e.g. height, padding). */
  buttonClassName?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumb = useSlidingIndicator(trackRef, 'button', 'button[aria-pressed="true"]', 1);

  return (
    <div
      ref={trackRef}
      className={cn(
        segmentedTrackClassName,
        'relative isolate flex w-full max-w-full flex-row items-center',
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <SlidingIndicator
        bounds={thumb}
        className="rounded-pill bg-surface-panel shadow-sm dark:ring-1 dark:ring-edge-strong/40"
      />
      {options.map((opt) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            title={opt.title ?? opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              segmentButtonClassName,
              selected ? 'text-fg' : 'text-fg-subtle',
              buttonClassName,
            )}
          >
            {Icon ? (
              <Icon className="block size-3 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
            ) : null}
            <span className="min-w-0 shrink truncate leading-none">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
