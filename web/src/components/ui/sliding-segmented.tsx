import type { LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { segmentedTrackClassName } from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';

export type SlidingSegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Optional native tooltip (defaults to `label`). */
  title?: string;
  icon?: LucideIcon;
};

type ThumbRect = { x: number; y: number; w: number; h: number };

/** Inset white thumb inside the segment hit-area so it does not kiss the track border (avoids bottom “bleed”). */
const THUMB_INSET_PX = 1;

/**
 * `position:absolute` children are positioned vs the padding edge; `getBoundingClientRect(track).top`
 * is the border box, so `br.top - tr.top` is off by `border-top` and looks like extra space above the thumb.
 */
function offsetFromAncestor(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== ancestor) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return cur === ancestor ? { x, y } : null;
}

/** Position uses translate3d (composited); width/height only when labels resize. */
const thumbFloatClassName =
  'pointer-events-none absolute left-0 top-0 z-[1] rounded-pill bg-surface-panel shadow-sm will-change-transform [backface-visibility:hidden] dark:bg-surface-panel dark:shadow-sm dark:ring-1 dark:ring-edge-strong/40';

/**
 * Native control — avoids merging `Button` base (`py-2`, `text-sm`, `gap-2`, `active:scale-95`)
 * with segment classes, which was skewing vertical alignment inside the pill.
 */
const segmentButtonClassName =
  'relative z-[2] box-border flex h-6 min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-pill border-0 bg-transparent px-2 py-0 text-center text-xs font-medium leading-none outline-none transition-[color,background-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel active:scale-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50';

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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<ThumbRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  /** After mount, enable sliding transition so the first layout does not animate from (0,0). */
  const [motionReady, setMotionReady] = useState(false);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const btn = btnRefs.current[idx];
    if (!btn) return;
    const i = THUMB_INSET_PX;
    const tr = track.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const rel = offsetFromAncestor(btn, track);
    let xBase: number;
    let yBase: number;
    if (rel) {
      xBase = rel.x;
      yBase = rel.y;
    } else {
      const cs = getComputedStyle(track);
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      xBase = br.left - tr.left - bl;
      yBase = br.top - tr.top - bt;
    }
    setThumb({
      x: xBase + i,
      y: yBase + i,
      w: Math.max(0, br.width - i * 2),
      h: Math.max(0, br.height - i * 2),
    });
    setReady(true);
  }, [options, value]);

  const measureRef = useRef(measure);
  measureRef.current = measure;

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(id);
  }, [measure]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMotionReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onResize = () => {
      requestAnimationFrame(() => measureRef.current());
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(track);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

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
      <div
        aria-hidden
        className={cn(
          thumbFloatClassName,
          'motion-reduce:!transition-none motion-reduce:!duration-0',
          motionReady &&
            'transition-[transform,width,height] duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]',
        )}
        style={{
          width: thumb.w,
          height: thumb.h,
          transform: `translate3d(${thumb.x}px, ${thumb.y}px, 0)`,
          opacity: ready && thumb.w > 0 ? 1 : 0,
        }}
      />
      {options.map((opt, i) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
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
