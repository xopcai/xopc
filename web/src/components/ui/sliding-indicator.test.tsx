// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { PageTabs } from './page-tabs';
import { SlidingSegmented } from './sliding-segmented';

it('keeps one surface aligned through selection, label resize, wrapping and missing selection', () => {
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const positions = [{ x: 4, y: 0, width: 72 }, { x: 80, y: 0, width: 120 }];
  const spies = (['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const).map(property =>
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') !== 'tab') return 0;
      const position = positions[this.textContent === 'one' ? 0 : 1];
      return property === 'offsetLeft' ? position.x : property === 'offsetTop' ? position.y : property === 'offsetWidth' ? position.width : 36;
    }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (activeTab: string) => act(() => root.render(<PageTabs
    items={[{ id: 'one', label: 'one' }, { id: 'two', label: 'two' }]}
    activeTab={activeTab} onChange={() => {}} ariaLabel="Pages"
  />));
  try {
    render('one');
    const surface = container.querySelector<HTMLElement>('[data-sliding-indicator]')!;
    expect(surface.style.transform).toBe('translate3d(4px, 0px, 0)');
    expect(surface.style.width).toBe('72px');
    expect(surface.classList).toContain('motion-reduce:transition-none');
    render('two');
    expect(container.querySelector('[data-sliding-indicator]')).toBe(surface);
    expect(surface.style.transform).toBe('translate3d(80px, 0px, 0)');
    expect(surface.style.width).toBe('120px');
    positions[1] = { x: 4, y: 40, width: 144 };
    act(() => resize());
    expect(surface.style.transform).toBe('translate3d(4px, 40px, 0)');
    expect(surface.style.width).toBe('144px');
    render('missing');
    expect(container.querySelector('[data-sliding-indicator]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    spies.forEach(spy => spy.mockRestore());
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalled();
});

it('uses the same inset surface for segmented controls', () => {
  const spies = (['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const).map(property =>
    vi.spyOn(HTMLElement.prototype, property, 'get').mockReturnValue(property === 'offsetWidth' ? 100 : property === 'offsetHeight' ? 28 : 4));
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<SlidingSegmented value="one" onChange={() => {}} options={[{ value: 'one', label: 'One' }]} aria-label="Views" />));
    const surface = container.querySelector<HTMLElement>('[data-sliding-indicator]')!;
    expect(surface.style.transform).toBe('translate3d(5px, 5px, 0)');
    expect(surface.style.width).toBe('98px');
    expect(surface.style.height).toBe('26px');
  } finally {
    act(() => root.unmount());
    spies.forEach(spy => spy.mockRestore());
  }
});
