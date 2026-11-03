import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { cn } from '@/lib/cn';
import { setTaskPanelOpen } from './task-detail-disclosure';
import { scrollTaskSection, type TaskSectionScroll } from './task-section-scroll';

/** Section navigation shared by the full page and task dialog. */
export function TaskDetailNavigation({ language, hasSchedule }: { language: 'zh' | 'en'; hasSchedule: boolean }) {
  const [params, setParams] = useSearchParams();
  const section = params.get('taskSection');
  const navRef = useRef<HTMLElement>(null);
  const syncedSection = useRef<string | null>(null);
  const scrollingTo = useRef<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setParamsRef = useRef(setParams);
  const sectionRef = useRef(section);
  useEffect(() => { setParamsRef.current = setParams; sectionRef.current = section; }, [setParams, section]);

  const scrollMotion = useRef<TaskSectionScroll | undefined>(undefined);
  const commitAfterScroll = useRef(false);
  const finishScroll = useCallback(() => {
    const id = scrollingTo.current;
    scrollingTo.current = null;
    scrollMotion.current = undefined;
    if (!id || !commitAfterScroll.current) return;
    commitAfterScroll.current = false;
    setParamsRef.current(previous => {
      const next = setTaskPanelOpen(previous, id, true);
      next.set('taskSection', id);
      return next;
    }, { preventScrollReset: true });
  }, []);

  const beginScroll = useCallback((id: string, commit = false) => {
    clearTimeout(settleTimer.current);
    scrollingTo.current = id;
    commitAfterScroll.current = commit;
    // Also release when the target is already in view and no scroll event fires.
    settleTimer.current = setTimeout(finishScroll, 800);
    scrollMotion.current = scrollTaskSection(navRef.current, id);
  }, [finishScroll]);
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
      if (scrollingTo.current) return;
      let scroller: HTMLElement | null = pane;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const edge = toolbar.getBoundingClientRect().bottom + 24;
      let current: HTMLElement | undefined = targets[0];
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= edge) current = target;
      }
      if (scroller && scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = targets.at(-1);
      if (!current) return;
      const id = current.dataset.taskSection!;
      setActive(id);
      if (sectionRef.current === id) return;
      syncedSection.current = id;
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        setParamsRef.current(previous => {
          const next = new URLSearchParams(previous);
          next.set('taskSection', id);
          return next;
        }, { replace: true, preventScrollReset: true });
      }, 160);
    };
    const onScroll = (event: Event) => {
      // Ignore scrolling inside reports, inputs, chat, and the horizontal navigation.
      if (!(event.target instanceof Element) || !event.target.contains(pane)) return;
      if (scrollingTo.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(finishScroll, 160);
        return;
      }
      clearTimeout(settleTimer.current);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const interrupt = (event: Event) => {
      if (!(event.target instanceof Node) || !pane.contains(event.target) || nav.contains(event.target)) return;
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
      scrollMotion.current?.cancel();
      scrollMotion.current = undefined;
      scrollingTo.current = null;
      commitAfterScroll.current = false;
      clearTimeout(settleTimer.current);
    };
    const onScrollEnd = (event: Event) => {
      if (event.target instanceof Element && event.target.contains(pane) && scrollingTo.current && (!scrollMotion.current || scrollMotion.current.isComplete())) {
        clearTimeout(settleTimer.current);
        finishScroll();
      }
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
    document.addEventListener('scrollend', onScrollEnd, true);
    document.addEventListener('wheel', interrupt, { capture: true, passive: true });
    document.addEventListener('touchstart', interrupt, { capture: true, passive: true });
    document.addEventListener('pointerdown', interrupt, { capture: true, passive: true });
    document.addEventListener('keydown', interrupt, true);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('scrollend', onScrollEnd, true);
      document.removeEventListener('wheel', interrupt, true);
      document.removeEventListener('touchstart', interrupt, true);
      document.removeEventListener('pointerdown', interrupt, true);
      document.removeEventListener('keydown', interrupt, true);
    };
  }, [language, hasSchedule, finishScroll]);

  useEffect(() => () => { clearTimeout(settleTimer.current); scrollMotion.current?.cancel(); }, []);

  useEffect(() => {
    if (!section || syncedSection.current === section) return;
    syncedSection.current = section;
    setActive(section);
    beginScroll(section);
  }, [section, beginScroll]);

  useEffect(() => {
    const nav = navRef.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !selected) return;
    const left = selected.offsetLeft < nav.scrollLeft ? selected.offsetLeft
      : selected.offsetLeft + selected.offsetWidth > nav.scrollLeft + nav.clientWidth
        ? selected.offsetLeft + selected.offsetWidth - nav.clientWidth : nav.scrollLeft;
    if (left !== nav.scrollLeft) nav.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [active, sections]);

  return <SlidingTabList scrollFocusedItemIntoView={false} as="nav" ref={navRef} aria-label={language === 'zh' ? '任务详情分区' : 'Task detail sections'} className="flex w-full gap-1 overflow-x-auto rounded-xl bg-surface-hover p-1" indicatorClassName="rounded-lg bg-surface-panel shadow-sm duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]">
    {sections.map(item => <button key={item.id} type="button" aria-current={active === item.id ? 'location' : undefined} aria-pressed={active === item.id} data-sliding-active={active === item.id} className={cn('relative z-10 min-h-9 min-w-max flex-1 touch-manipulation rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active === item.id ? 'text-fg' : 'text-fg-muted hover:text-fg')} onClick={() => {
      syncedSection.current = item.id;
      setActive(item.id);
      beginScroll(item.id, true);
    }}>{item.label}</button>)}
  </SlidingTabList>;
}
