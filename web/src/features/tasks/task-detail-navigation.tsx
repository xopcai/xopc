import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { cn } from '@/lib/cn';
import { setTaskPanelOpen } from './task-detail-disclosure';

function scrollToSection(nav: HTMLElement | null, id: string) {
  const target = Array.from(nav?.closest('.task-detail-scroll')?.querySelectorAll<HTMLElement>('[data-task-section]') ?? [])
    .find(item => item.dataset.taskSection === id);
  if (!target) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

/** Section navigation shared by the full page and task dialog. */
export function TaskDetailNavigation({ language, hasSchedule }: { language: 'zh' | 'en'; hasSchedule: boolean }) {
  const [params, setParams] = useSearchParams();
  const section = params.get('taskSection');
  const navRef = useRef<HTMLElement>(null);
  const syncedSection = useRef<string | null>(null);
  const [active, setActive] = useState(section ?? 'results');
  const [sections, setSections] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    const nav = navRef.current;
    const pane = nav?.closest<HTMLElement>('.task-detail-scroll');
    const toolbar = nav?.parentElement;
    if (!pane || !toolbar) return;
    const targets = Array.from(pane.querySelectorAll<HTMLElement>('[data-task-section]'));
    setSections(targets.map(target => ({ id: target.dataset.taskSection!, label: target.dataset.taskSectionLabel! })));
    let frame = 0;
    const update = () => {
      let scroller: HTMLElement | null = pane;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const height = toolbar.getBoundingClientRect().height;
      for (const target of targets) target.style.scrollMarginTop = `${height + 16}px`;
      const edge = toolbar.getBoundingClientRect().bottom + 24;
      let current: HTMLElement | undefined = targets[0];
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= edge) current = target;
      }
      if (scroller && scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = targets.at(-1);
      if (!current) return;
      const id = current.dataset.taskSection!;
      setActive(id);
      if (syncedSection.current === id) return;
      syncedSection.current = id;
      setParams(previous => {
        const next = new URLSearchParams(previous);
        next.set('taskSection', id);
        return next;
      }, { replace: true, preventScrollReset: true });
    };
    const onScroll = (event: Event) => {
      // Ignore scrolling inside reports, inputs, chat, and the horizontal navigation.
      if (!(event.target instanceof Element) || !event.target.contains(pane)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const measure = () => {
      const height = toolbar.getBoundingClientRect().height;
      for (const target of targets) target.style.scrollMarginTop = `${height + 16}px`;
    };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(toolbar);
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [language, hasSchedule, setParams]);

  useEffect(() => {
    if (!section || syncedSection.current === section) return;
    syncedSection.current = section;
    setActive(section);
    scrollToSection(navRef.current, section);
  }, [section]);

  useEffect(() => {
    const nav = navRef.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !selected) return;
    if (selected.offsetLeft < nav.scrollLeft) nav.scrollLeft = selected.offsetLeft;
    else if (selected.offsetLeft + selected.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = selected.offsetLeft + selected.offsetWidth - nav.clientWidth;
    }
  }, [active, sections]);

  return <SlidingTabList as="nav" ref={navRef} aria-label={language === 'zh' ? '任务详情分区' : 'Task detail sections'} className="flex w-full gap-1 overflow-x-auto rounded-xl bg-surface-hover p-1" indicatorClassName="rounded-lg bg-surface-panel shadow-sm">
    {sections.map(item => <button key={item.id} type="button" aria-current={active === item.id ? 'location' : undefined} aria-pressed={active === item.id} data-sliding-active={active === item.id} className={cn('relative z-10 min-h-9 shrink-0 touch-manipulation rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active === item.id ? 'text-fg' : 'text-fg-muted hover:text-fg')} onClick={() => {
      syncedSection.current = item.id;
      setActive(item.id);
      scrollToSection(navRef.current, item.id);
      setParams(previous => {
        const next = setTaskPanelOpen(previous, item.id, true);
        next.set('taskSection', item.id);
        return next;
      }, { preventScrollReset: true });
    }}>{item.label}</button>)}
  </SlidingTabList>;
}
