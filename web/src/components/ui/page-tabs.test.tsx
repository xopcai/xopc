// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { PageTabs } from './page-tabs';

it('moves selection and focus together, wraps arrows, and supports Home and End', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  function Example() {
    const [active, setActive] = useState('one');
    return <PageTabs items={['one', 'two', 'three'].map(id => ({ id, label: id }))} activeTab={active} onChange={setActive} ariaLabel="Pages" />;
  }
  try {
    act(() => root.render(<Example />));
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    tabs[0].focus();
    for (const [key, index] of [['ArrowLeft', 2], ['Home', 0], ['ArrowRight', 1], ['End', 2]] as const) {
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
