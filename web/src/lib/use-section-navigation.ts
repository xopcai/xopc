import { useEffect, useRef, useState, type RefObject } from 'react';

function findScrollPane(element: HTMLElement): HTMLElement | null {
  let pane = element.parentElement;
  while (pane && !/^(auto|scroll|overlay)$/.test(getComputedStyle(pane).overflowY)) {
    pane = pane.parentElement;
  }
  return pane;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

export function useSectionNavigation({
  contentRef, toolbarRef, navRef, sectionAttribute, initialSectionId, alignLastSection = false,
}: {
  contentRef: RefObject<HTMLElement | null>;
  toolbarRef: RefObject<HTMLElement | null>;
  navRef: RefObject<HTMLElement | null>;
  sectionAttribute: string;
  initialSectionId: string;
  alignLastSection?: boolean;
}) {
  const destination = useRef<number | null>(null);
  const [active, setActive] = useState(initialSectionId);

  useEffect(() => {
    const content = contentRef.current;
    const toolbar = toolbarRef.current;
    if (!content || !toolbar) return;
    const pane = findScrollPane(content);
    if (!pane) return;
    let frame = 0;

    const syncActive = () => {
      frame = 0;
      if (destination.current !== null) {
        if (Math.abs(pane.scrollTop - destination.current) <= 1) destination.current = null;
        return;
      }
      const targets = [...content.querySelectorAll<HTMLElement>(`[${sectionAttribute}]`)];
      const edge = toolbar.getBoundingClientRect().bottom + 9;
      const scrollLimit = pane.scrollHeight - pane.clientHeight;
      const atEnd = scrollLimit > 1 && pane.scrollTop >= scrollLimit - 1;
      const current = (atEnd ? targets.at(-1) : targets.findLast(target => target.getBoundingClientRect().top <= edge)) ?? targets[0];
      const id = current?.getAttribute(sectionAttribute);
      if (id) setActive(id);
    };
    const scheduleSync = () => { if (!frame) frame = requestAnimationFrame(syncActive); };
    const releaseDestination = () => { destination.current = null; };
    const finishScroll = () => {
      if (destination.current === null || Math.abs(pane.scrollTop - destination.current) <= 1) return;
      releaseDestination();
      scheduleSync();
    };
    const releaseOnScrollKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) releaseDestination();
    };

    pane.addEventListener('scroll', scheduleSync, { passive: true });
    pane.addEventListener('scrollend', finishScroll);
    pane.addEventListener('wheel', releaseDestination, { passive: true });
    pane.addEventListener('touchstart', releaseDestination, { passive: true });
    pane.addEventListener('pointerdown', releaseDestination);
    pane.addEventListener('keydown', releaseOnScrollKey);
    const measureTail = () => {
      if (alignLastSection) {
        content.style.setProperty('--section-scroll-tail-height', `${Math.max(0, pane.clientHeight - toolbar.offsetHeight - 8)}px`);
      }
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      measureTail();
      scheduleSync();
    });
    resize?.observe(content);
    resize?.observe(pane);
    if (alignLastSection) resize?.observe(toolbar);
    measureTail();
    scheduleSync();

    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      pane.removeEventListener('scroll', scheduleSync);
      pane.removeEventListener('scrollend', finishScroll);
      pane.removeEventListener('wheel', releaseDestination);
      pane.removeEventListener('touchstart', releaseDestination);
      pane.removeEventListener('pointerdown', releaseDestination);
      pane.removeEventListener('keydown', releaseOnScrollKey);
    };
  }, [alignLastSection, contentRef, sectionAttribute, toolbarRef]);

  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !button) return;
    const track = nav.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    const delta = item.left < track.left ? item.left - track.left : Math.max(0, item.right - track.right);
    if (delta) nav.scrollBy({ left: delta, behavior: scrollBehavior() });
  }, [active, navRef]);

  function jumpTo(id: string) {
    const content = contentRef.current;
    const toolbar = toolbarRef.current;
    const target = [...content?.querySelectorAll<HTMLElement>(`[${sectionAttribute}]`) ?? []]
      .find(section => section.getAttribute(sectionAttribute) === id);
    if (!content || !toolbar || !target) return;

    setActive(id);
    const pane = findScrollPane(content);
    if (!pane) {
      target.scrollIntoView?.({ block: 'start', behavior: scrollBehavior() });
      return;
    }

    const top = Math.max(0, Math.min(pane.scrollHeight - pane.clientHeight,
      pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top
      - pane.clientTop - toolbar.getBoundingClientRect().height - 8));
    if (Math.abs(pane.scrollTop - top) < 1) {
      if (destination.current !== null) pane.scrollTo({ top, behavior: 'instant' });
      destination.current = null;
      return;
    }
    destination.current = top;
    pane.scrollTo({ top, behavior: scrollBehavior() });
  }

  return { active, jumpTo };
}
