import { useEffect, type RefObject } from 'react';

export interface UseDismissOnOutsideClickOptions {
  active: boolean;
  /** Refs that should NOT trigger dismissal when clicked. */
  anchors: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** Optional CSS selector for floating UI bits portaled outside `anchors` (e.g. tooltips). */
  ignoreSelector?: string;
  onDismiss: () => void;
}

/**
 * Captures `pointerdown` on the document while `active`. Calls `onDismiss` when the click
 * lands outside every anchor and is not inside an element matching `ignoreSelector`.
 *
 * Mirrors the pattern in `chat-composer.tsx` for closing the slash palette without losing
 * focus on the editor itself.
 */
export function useDismissOnOutsideClick({
  active,
  anchors,
  ignoreSelector,
  onDismiss,
}: UseDismissOnOutsideClickOptions): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      for (const ref of anchors) {
        const el = ref.current;
        if (el && el.contains(target)) return;
      }
      if (ignoreSelector && target instanceof Element && target.closest(ignoreSelector)) {
        return;
      }
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active, anchors, ignoreSelector, onDismiss]);
}
