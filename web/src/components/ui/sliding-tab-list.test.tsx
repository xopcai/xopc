// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { SlidingTabList } from './sliding-tab-list';

it('slides over the complete closable tab while preserving refs, close actions and disabled tabs', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const track = createRef<HTMLDivElement>();
  const close = vi.fn();
  const change = vi.fn();
  const spies = ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight', 'offsetParent'].map(property =>
    vi.spyOn(HTMLElement.prototype, property as 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight' | 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      if (property === 'offsetParent') return this.parentElement;
      if (property === 'offsetWidth') return 120;
      if (property === 'offsetHeight') return 36;
      if (property === 'offsetLeft') return this.dataset.tab === 'two' ? 124 : 0;
      return 0;
    }));
  const render = (active: string, ids = ['one', 'two']) => act(() => root.render(
    <SlidingTabList ref={track} role="tablist" aria-label="Workspace tabs" className="flex">
      {ids.map(id => <div key={id} data-tab={id} data-sliding-active={id === active}>
        <button role="tab" aria-selected={id === active} disabled={id === 'two'} onClick={() => change(id)}>{id}</button>
        <button aria-label={`Close ${id}`} onClick={() => close(id)}>×</button>
      </div>)}
    </SlidingTabList>,
  ));
  try {
    render('one');
    const surface = container.querySelector<HTMLElement>('[data-sliding-indicator]')!;
    expect(track.current).toBe(container.firstElementChild);
    expect(surface.style.width).toBe('120px');
    expect(track.current?.dataset.slidingReady).toBe('true');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Close one"]')!.click());
    expect(close).toHaveBeenCalledWith('one');
    act(() => container.querySelector<HTMLButtonElement>('button[role="tab"]:disabled')!.click());
    expect(change).not.toHaveBeenCalled();
    render('two');
    expect(container.querySelector('[data-sliding-indicator]')).toBe(surface);
    expect(surface.style.transform).toBe('translate3d(124px, 0px, 0)');
    render('two', ['one']);
    expect(container.querySelector('[data-sliding-indicator]')).toBeNull();
    expect(track.current?.dataset.slidingReady).toBeUndefined();
  } finally {
    act(() => root.unmount());
    spies.forEach(spy => spy.mockRestore());
    container.remove();
  }
  expect(track.current).toBeNull();
});

it('adds offsets through nested wrappers for a custom tab label', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const spies = ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight', 'offsetParent'].map(property =>
    vi.spyOn(HTMLElement.prototype, property as 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight' | 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      if (property === 'offsetParent') return this.parentElement;
      if (property === 'offsetWidth') return 80;
      if (property === 'offsetHeight') return 32;
      if (property === 'offsetLeft') return this.tagName === 'BUTTON' ? 8 : 100;
      return 0;
    }));
  try {
    act(() => root.render(<SlidingTabList role="group" aria-label="View"><div><button aria-pressed>Preview</button></div></SlidingTabList>));
    expect(container.querySelector<HTMLElement>('[data-sliding-indicator]')?.style.transform).toBe('translate3d(108px, 0px, 0)');
  } finally {
    act(() => root.unmount());
    spies.forEach(spy => spy.mockRestore());
  }
});


it('tracks selection inside independently rendered children and skips disabled options with the keyboard', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const spies = ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight', 'offsetParent'].map(property =>
    vi.spyOn(HTMLElement.prototype, property as 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight' | 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      if (property === 'offsetParent') return this.parentElement;
      if (property === 'offsetWidth') return 80;
      if (property === 'offsetHeight') return 32;
      if (property === 'offsetLeft') return this.textContent === 'Three' ? 168 : 0;
      return 0;
    }));
  function Options() {
    const [selected, setSelected] = useState('One');
    return <>{['One', 'Two', 'Three'].map(label => <button key={label} aria-pressed={selected === label} disabled={label === 'Two'} onClick={() => setSelected(label)}>{label}</button>)}</>;
  }
  try {
    await act(async () => root.render(<SlidingTabList role="group" aria-label="Views"><Options /></SlidingTabList>));
    const buttons = container.querySelectorAll('button');
    buttons[0].focus();
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLElement>('[data-sliding-indicator]')?.style.transform).toBe('translate3d(168px, 0px, 0)');
    await act(async () => buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);
  } finally {
    act(() => root.unmount());
    spies.forEach(spy => spy.mockRestore());
    container.remove();
  }
});
