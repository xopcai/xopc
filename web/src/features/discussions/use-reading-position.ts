import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** Restore the visible block before paint when live content above it changes. */
export function useReadingPosition(viewport: RefObject<HTMLElement | null>) {
  const pending = useRef<{ scrollTop: number; anchors: { key: string; top: number }[] } | null>(null);
  const capture = useCallback(() => {
    const element = viewport.current;
    if (!element || pending.current) return;
    const top = element.getBoundingClientRect().top;
    pending.current = {
      scrollTop: element.scrollTop,
      anchors: element.scrollTop <= 0 ? [] : Array.from(element.querySelectorAll<HTMLElement>('[data-reading-anchor]'))
        .filter(block => block.getBoundingClientRect().bottom > top)
        .map(block => ({ key: block.dataset.readingAnchor!, top: block.getBoundingClientRect().top - top })),
    };
  }, [viewport]);
  useLayoutEffect(() => {
    const saved = pending.current;
    const element = viewport.current;
    pending.current = null;
    if (!saved || !element) return;
    const blocks = new Map(Array.from(element.querySelectorAll<HTMLElement>('[data-reading-anchor]')).map(block => [block.dataset.readingAnchor, block]));
    const anchor = saved.anchors.find(item => blocks.has(item.key));
    element.scrollTop = anchor
      ? element.scrollTop + blocks.get(anchor.key)!.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.top
      : saved.scrollTop;
  });
  return capture;
}
