// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { PageTabs } from './page-tabs';

it.each(['horizontal', 'vertical'] as const)('moves selection and focus together with %s navigation', (orientation) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  function Example() {
    const [active, setActive] = useState('one');
    return <PageTabs items={['one', 'two', 'three'].map(id => ({ id, label: id }))} activeTab={active} onChange={setActive} ariaLabel="Pages" orientation={orientation} />;
  }
  try {
    act(() => root.render(<Example />));
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    tabs[0].focus();
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-orientation')).toBe(orientation);
    for (const [key, index] of [[orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft', 2], ['Home', 0], [orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight', 1], ['End', 2]] as const) {
      act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
      expect(document.activeElement).toBe(tabs[index]);
      expect(tabs[index].getAttribute('aria-selected')).toBe('true');
      expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([tabs[index]]);
    }
    expect(scroll).toHaveBeenCalledTimes(4);
  } finally {
    act(() => root.unmount());
    container.remove();
    HTMLElement.prototype.scrollIntoView = original;
  }
});

it('keeps the keyboard focus ring inside horizontally scrolling tabs', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    act(() => root.render(
      <PageTabs
        items={[{ id: 'one', label: 'one' }]}
        activeTab="one"
        onChange={() => undefined}
        ariaLabel="Pages"
      />,
    ));

    expect(container.querySelector('[role="tab"]')?.classList).toContain('focus-visible:ring-inset');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
