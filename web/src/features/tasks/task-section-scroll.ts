export interface TaskSectionScroll {
  cancel: () => void;
  isComplete: () => boolean;
}

/** Scroll only the task pane, leaving the dialog, page and adjacent chat in place. */
export function scrollTaskSection(nav: HTMLElement | null, id: string): TaskSectionScroll | undefined {
  const pane = nav?.closest<HTMLElement>('.task-detail-scroll');
  const target = Array.from(pane?.querySelectorAll<HTMLElement>('[data-task-section]') ?? [])
    .find(item => item.dataset.taskSection === id);
  if (!target || !pane) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  let scroller: HTMLElement | null = pane;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!scroller) {
    target.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    return;
  }
  // Read geometry once, then let the browser animate scrolling off the React path.
  const inset = (nav?.parentElement?.getBoundingClientRect().height ?? 0) + 16;
  const top = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
    scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop - inset));
  scroller.scrollTo({ top, behavior: reducedMotion ? 'instant' : 'smooth' });
  const owner = scroller;
  return {
    cancel: () => owner.scrollTo({ top: owner.scrollTop, behavior: 'instant' }),
    isComplete: () => Math.abs(owner.scrollTop - top) < 1,
  };
}
