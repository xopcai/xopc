import { useLayoutEffect, type RefObject } from 'react';

/** Native guests must yield to DOM overlays; CSS z-index cannot cover a WebContentsView. */
export function useBrowserLayout(ref: RefObject<HTMLDivElement | null>, id: string | undefined, visible: boolean) {
  useLayoutEffect(() => {
    const api = window.electronAPI?.browser;
    const node = ref.current;
    if (!api || !id || !node) return;
    let frame = 0;
    let previous = '';
    let disposed = false;
    const sync = () => {
      frame = 0;
      if (disposed) return;
      const overlay = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-browser-occluder]')].some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
      const ancestors = [node.closest('[data-right-workspace]'), node.closest('[role="tabpanel"]')].filter(Boolean) as HTMLElement[];
      const moving = ancestors.some(el => el.getAnimations().some(a => a.playState === 'running'));
      const rect = node.getBoundingClientRect();
      const shown = visible && !overlay && !moving && node.getClientRects().length > 0 && document.visibilityState === 'visible';
      const bounds = shown ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      const key = JSON.stringify(bounds);
      if (key !== previous) { previous = key; void api.present(id, bounds).catch(() => {}); }
      if (moving) frame = requestAnimationFrame(sync);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state'] });
    const focus = () => { previous = ''; schedule(); };
    window.addEventListener('focus', focus);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener('focus', focus); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); document.removeEventListener('visibilitychange', schedule); void api.present(id, null).catch(() => {}); };
  }, [id, ref, visible]);
}
