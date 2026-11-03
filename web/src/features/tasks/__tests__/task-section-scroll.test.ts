// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scrollTaskSection } from '../task-section-scroll';

function fixture() {
  const outer = document.createElement('div');
  outer.style.overflowY = 'auto';
  outer.innerHTML = '<div class="task-detail-scroll" style="overflow-y:auto"><div><nav></nav></div><details data-task-section="goal"><summary>Goal</summary>Content</details></div>';
  document.body.append(outer);
  const pane = outer.querySelector<HTMLElement>('.task-detail-scroll')!;
  const nav = pane.querySelector('nav')!;
  const target = pane.querySelector('details')!;
  Object.defineProperties(pane, { scrollHeight: { value: 5000 }, clientHeight: { value: 600 }, clientTop: { value: 2 } });
  pane.scrollTop = 100;
  pane.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
  nav.parentElement!.getBoundingClientRect = () => ({ height: 80 }) as DOMRect;
  target.getBoundingClientRect = () => ({ top: 1250 }) as DOMRect;
  pane.scrollTo = vi.fn();
  outer.scrollTo = vi.fn();
  return { outer, pane, nav, target };
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('task section scrolling', () => {
  it('animates only the nearest scroll container and can stop at the current position', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { outer, pane, nav, target } = fixture();
    const motion = scrollTaskSection(nav, 'goal')!;
    expect(target.open).toBe(true);
    expect(pane.scrollTo).toHaveBeenCalledWith({ top: 1202, behavior: 'smooth' });
    expect(outer.scrollTo).not.toHaveBeenCalled();
    expect(motion.isComplete()).toBe(false);
    pane.scrollTop = 1202;
    expect(motion.isComplete()).toBe(true);
    pane.scrollTop = 320;
    motion.cancel();
    expect(pane.scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'instant' });
  });

  it('clamps the destination and respects reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { pane, nav, target } = fixture();
    target.getBoundingClientRect = () => ({ top: 10000 }) as DOMRect;
    scrollTaskSection(nav, 'goal');
    expect(pane.scrollTo).toHaveBeenCalledWith({ top: 4400, behavior: 'instant' });
  });
});
