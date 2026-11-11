import type { LucideIcon } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';

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
  flush = false,
  className,
  buttonClassName,
  indicatorClassName,
  onReorder,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SlidingSegmentOption<T>[];
  'aria-label': string;
  /** Align the selected surface to the track edges without an outline or inset. */
  flush?: boolean;
  className?: string;
  /** Extra classes for each segment button (e.g. height, padding). */
  buttonClassName?: string;
  indicatorClassName?: string;
  onReorder?: (order: T[]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumb = useSlidingIndicator(trackRef, 'button', 'button[aria-pressed="true"]', flush ? 0 : 1);
  const pointer = useRef<{
    id: number;
    button: HTMLButtonElement;
    startX: number;
    startY: number;
    index: number;
    target: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ index: number; target: number; offset: number } | null>(null);

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= options.length) return;
    const order = options.map(option => option.value);
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    onReorder?.(order);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    pointer.current = {
      id: event.pointerId, button: event.currentTarget, startX: event.clientX, startY: event.clientY, index, target: index,
    };
  }

  function updateDrag(event: PointerEvent<HTMLButtonElement>) {
    const press = pointer.current;
    const track = trackRef.current;
    if (!press || press.id !== event.pointerId || event.buttons !== 1 || !track) return;
    const delta = event.clientX - press.startX;
    const button = press.button;
    if (!suppressClick.current) {
      if (Math.abs(delta) < 6 || Math.abs(delta) <= Math.abs(event.clientY - press.startY)) return;
      // Touch and pen already capture the pressed icon or label implicitly.
      if (event.pointerType === 'mouse') button.setPointerCapture(event.pointerId);
      suppressClick.current = true;
    }
    const rect = track.getBoundingClientRect();
    const offset = Math.max(-button.offsetLeft, Math.min(delta, track.clientWidth - button.offsetLeft - button.offsetWidth));
    const center = button.offsetLeft + button.offsetWidth / 2 + offset;
    const buttons = Array.from(track.querySelectorAll('button'));
    const target = buttons.findIndex(item => center >= item.offsetLeft && center < item.offsetLeft + item.offsetWidth);
    press.target = target < 0 || event.clientY < rect.top || event.clientY > rect.bottom ? press.index : target;
    setDrag({ index: press.index, target: press.target, offset });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const press = pointer.current;
    if (!press || press.id !== event.pointerId) return;
    pointer.current = null;
    setDrag(null);
    if (commit && suppressClick.current) move(press.index, press.target);
  }

  return (
    <div
      ref={trackRef}
      className={cn(
        flush ? 'rounded-pill bg-surface-hover' : segmentedTrackClassName,
        'relative isolate flex w-full max-w-full flex-row items-center',
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <SlidingIndicator
        bounds={thumb}
        className={cn(
          'rounded-pill',
          flush ? 'bg-surface-active' : 'bg-surface-panel shadow-sm dark:ring-1 dark:ring-edge-strong/40',
          indicatorClassName,
        )}
      />
      {options.map((opt, index) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        const dragging = drag?.index === index;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            title={opt.title ?? opt.label}
            onClick={(event) => {
              if (event.detail > 0 && suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              onChange(opt.value);
            }}
            aria-keyshortcuts={onReorder ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
            onKeyDown={onReorder ? (event) => {
              if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
              event.preventDefault();
              const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
              move(index, index + direction * (event.key === 'ArrowRight' ? 1 : -1));
            } : undefined}
            onPointerDown={onReorder ? (event) => startDrag(event, index) : undefined}
            onPointerMove={onReorder ? updateDrag : undefined}
            onPointerUp={onReorder ? (event) => endDrag(event, true) : undefined}
            onPointerCancel={onReorder ? (event) => endDrag(event, false) : undefined}
            onLostPointerCapture={onReorder ? (event) => endDrag(event, false) : undefined}
            style={dragging ? { translate: `${drag.offset}px` } : undefined}
            className={cn(
              segmentButtonClassName,
              selected ? 'text-fg' : 'text-fg-subtle',
              buttonClassName,
              onReorder && 'touch-pan-y cursor-grab select-none',
              dragging && 'z-[3] cursor-grabbing bg-surface-active text-fg shadow-sm',
              drag?.target === index && !dragging && 'ring-1 ring-inset ring-edge-strong',
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
