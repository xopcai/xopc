import { useLayoutEffect, useState, type RefObject } from 'react';

import { cn } from '@/lib/cn';

type IndicatorBounds = { x: number; y: number; width: number; height: number };

/** Measure in scroll-content coordinates so scrolling never separates the surface from its item. */
export function useSlidingIndicator(
  trackRef: RefObject<HTMLElement | null>,
  itemSelector: string,
  selectedSelector: string,
  inset = 0,
) {
  const [bounds, setBounds] = useState<IndicatorBounds | null>(null);

  // Remeasure after every commit, including label, order and selection changes.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const selected = track.querySelector<HTMLElement>(selectedSelector);
      let x = 0;
      let y = 0;
      let ancestor: HTMLElement | null = selected;
      while (ancestor && ancestor !== track) {
        x += ancestor.offsetLeft;
        y += ancestor.offsetTop;
        ancestor = ancestor.offsetParent as HTMLElement | null;
      }
      const next = selected && selected.offsetWidth > 0 && selected.offsetHeight > 0 ? {
        x: x + inset,
        y: y + inset,
        width: Math.max(0, selected.offsetWidth - inset * 2),
        height: Math.max(0, selected.offsetHeight - inset * 2),
      } : null;
      setBounds(previous => {
        if (previous?.x === next?.x && previous?.y === next?.y
          && previous?.width === next?.width && previous?.height === next?.height) return previous;
        return next;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(track);
    track.querySelectorAll<HTMLElement>(itemSelector).forEach(item => observer?.observe(item));
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    mutations?.observe(track, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current', 'data-sliding-active'],
    });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  return bounds;
}

/** A single persistent surface shared by page tabs and segmented controls. */
export function SlidingIndicator({ bounds, className }: { bounds: IndicatorBounds | null; className?: string }) {
  if (!bounds) return null;
  return (
    <span
      aria-hidden="true"
      data-sliding-indicator=""
      className={cn(
        'pointer-events-none absolute left-0 top-0 z-0 transition-[transform,width,height] duration-250 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        className,
      )}
      style={{ width: bounds.width, height: bounds.height, transform: `translate3d(${bounds.x}px, ${bounds.y}px, 0)` }}
    />
  );
}
