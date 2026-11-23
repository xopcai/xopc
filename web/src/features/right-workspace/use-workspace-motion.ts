import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Retains controllers during exit; animation cancellation makes rapid reversals safe. */
export function useWorkspaceMotion(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  variant: 'default' | 'personal' = 'default',
) {
  const [present, setPresent] = useState(open);
  const wasOpen = useRef(false);
  const interrupted = useRef<Keyframe | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !present) { setPresent(true); return; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reduce?.matches || typeof node.animate !== 'function') {
      wasOpen.current = open;
      if (present !== open) setPresent(open);
      return;
    }
    const changed = wasOpen.current !== open;
    wasOpen.current = open;
    let animation: Animation | undefined;
    let cancelled = false;
    if ((changed || !open) && present) {
      const personal = variant === 'personal';
      const offset = personal ? '22px' : '16px';
      const from = interrupted.current ?? (open ? { opacity: 0, transform: `translateX(${offset})` } : { opacity: 1, transform: 'translateX(0)' });
      interrupted.current = null;
      animation = node.animate(
        [from, open ? { opacity: 1, transform: 'translateX(0)' } : { opacity: 0, transform: `translateX(${offset})` }],
        {
          duration: personal ? (open ? 420 : 320) : (open ? 220 : 150),
          easing: personal ? 'cubic-bezier(0.32, 0.72, 0, 1)' : 'cubic-bezier(0.2, 0, 0, 1)',
          fill: 'both',
        },
      );
      if (!open) void animation.finished.then(() => { if (!cancelled) setPresent(false); }).catch(() => {});
    }
    const finishReduced = () => { if (reduce?.matches) { animation?.cancel(); if (!open) setPresent(false); } };
    reduce?.addEventListener('change', finishReduced);
    return () => { cancelled = true;
      if ((changed || !open) && animation?.playState === 'running') {
        const style = window.getComputedStyle(node);
        interrupted.current = { opacity: style.opacity, transform: style.transform };
      }
      animation?.cancel(); reduce?.removeEventListener('change', finishReduced); };
  }, [open, present, ref, variant]);
  return present;
}
