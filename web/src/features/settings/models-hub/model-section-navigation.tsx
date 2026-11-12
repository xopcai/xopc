import { useEffect, useRef, useState, type ReactNode } from 'react';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { cn } from '@/lib/cn';

import { capabilityGroups } from './capability-navigation';

const servicesSection = { id: 'services', label: ['服务账户', 'Service accounts'] } as const;
const sections = [...capabilityGroups.map(group => ({ id: group.uses[0], label: group.label })), servicesSection];

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

export function ModelSectionNavigation({ zh, children }: { zh: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const destination = useRef<number | null>(null);
  const [active, setActive] = useState<string>(sections[0].id);

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
      const targets = [...content.querySelectorAll<HTMLElement>('[data-model-section]')];
      const edge = toolbar.getBoundingClientRect().bottom + 9;
      const scrollLimit = pane.scrollHeight - pane.clientHeight;
      const atEnd = scrollLimit > 1 && pane.scrollTop >= scrollLimit - 1;
      const current = (atEnd ? targets.at(-1) : targets.findLast(target => target.getBoundingClientRect().top <= edge)) ?? targets[0];
      if (current?.dataset.modelSection) setActive(current.dataset.modelSection);
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
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleSync);
    resize?.observe(content);
    resize?.observe(pane);
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
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !button) return;
    const track = nav.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    const delta = item.left < track.left ? item.left - track.left : Math.max(0, item.right - track.right);
    if (delta) nav.scrollBy({ left: delta, behavior: scrollBehavior() });
  }, [active]);

  function jumpTo(id: string) {
    const content = contentRef.current;
    const toolbar = toolbarRef.current;
    const target = content?.querySelector<HTMLElement>(`[data-model-section="${id}"]`);
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

  return <div ref={contentRef} className="flex min-w-0 flex-col gap-5">
    <div ref={toolbarRef} className="sticky top-0 z-10 min-w-0 bg-surface-panel py-1">
      <SlidingTabList as="nav" ref={navRef} aria-label={zh ? '模型配置分区' : 'Model settings sections'}
        scrollFocusedItemIntoView={false} className="flex w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-inset p-1"
        indicatorClassName="rounded-lg bg-surface-panel ring-1 ring-edge-subtle motion-reduce:transition-none">
        {sections.map(section => <button key={section.id} type="button"
          aria-current={active === section.id ? 'location' : undefined}
          aria-pressed={active === section.id}
          className={cn('touch-target relative z-10 min-h-9 min-w-max flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
            active === section.id ? 'text-fg' : 'text-fg-muted hover:text-fg')}
          onClick={() => jumpTo(section.id)}>
          {section.label[zh ? 0 : 1]}
        </button>)}
      </SlidingTabList>
    </div>
    {children}
  </div>;
}
