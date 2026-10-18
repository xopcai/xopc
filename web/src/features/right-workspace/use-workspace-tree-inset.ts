import { useLayoutEffect, useState, type RefObject } from 'react';

/** Keep overlay trees below the active toolbar so their own toggle stays reachable. */
export function useWorkspaceTreeInset(ref: RefObject<HTMLElement | null>, open: boolean, activeId: string | null) {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const content = ref.current?.querySelector<HTMLElement>('#workspace-content');
    const toolbar = content && [...content.querySelectorAll<HTMLElement>('[data-workspace-toolbar]')]
      .find(node => node.getClientRects().length > 0);
    if (!open || !content || !toolbar) { setInset(0); return; }
    const update = () => setInset(Math.max(0, toolbar.getBoundingClientRect().bottom - content.getBoundingClientRect().top));
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(toolbar);
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [activeId, open, ref]);
  return inset;
}
