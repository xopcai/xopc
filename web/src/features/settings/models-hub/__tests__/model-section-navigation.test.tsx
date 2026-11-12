// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ModelSectionNavigation } from '../model-section-navigation';

it('jumps inside the settings pane and tracks the visible section during manual scrolling', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const pane = document.createElement('div');
  pane.style.overflowY = 'auto';
  document.body.append(pane);
  Object.defineProperties(pane, { scrollHeight: { value: 1600 }, clientHeight: { value: 400 } });
  const scrollTo = vi.fn();
  pane.scrollTo = scrollTo;
  const root = createRoot(pane);
  let nextFrame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  try {
    act(() => root.render(<ModelSectionNavigation zh={false}>
      <section data-model-section="chat" />
      <section data-model-section="vision" />
      <section data-model-section="services" />
    </ModelSectionNavigation>));

    const nav = pane.querySelector('nav')!;
    const toolbar = nav.parentElement!;
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: 48 }));
    const targets = [...pane.querySelectorAll<HTMLElement>('[data-model-section]')];
    targets.forEach((target, index) => vi.spyOn(target, 'getBoundingClientRect')
      .mockImplementation(() => DOMRect.fromRect({ y: 80 + index * 600 - pane.scrollTop, height: 550 })));

    const visual = [...nav.querySelectorAll('button')].find(button => button.textContent === 'Visual')!;
    act(() => nextFrame?.(0));
    act(() => visual.click());
    expect(scrollTo).toHaveBeenCalledWith({ top: 624, behavior: 'smooth' });
    expect(visual.getAttribute('aria-current')).toBe('location');

    act(() => {
      pane.scrollTop = 200;
      pane.dispatchEvent(new Event('scroll'));
      nextFrame?.(1);
    });
    expect(visual.getAttribute('aria-current')).toBe('location');

    act(() => {
      pane.dispatchEvent(new Event('wheel'));
      pane.scrollTop = 1200;
      pane.dispatchEvent(new Event('scroll'));
      nextFrame?.(2);
    });
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe('Service accounts');
  } finally {
    act(() => root.unmount());
    pane.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
