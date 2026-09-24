// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductSectionHeader } from '@/components/shell/product-section-header';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
});

function renderAt(path: string) {
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  unmount = () => root.unmount();
  act(() => root.render(
    <MemoryRouter initialEntries={[path]}>
      <ProductSectionHeader fallback={<span>Page title</span>} />
    </MemoryRouter>,
  ));
}

describe('ProductSectionHeader', () => {
  it('keeps the same work section structure on list and detail routes', () => {
    renderAt('/projects/example');

    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Projects',
      'Notes',
    ]);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Projects');
  });

  it('keeps automation management first and run history selected when requested', () => {
    renderAt('/automations?view=activity');

    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Automations',
      'Scenes',
      'Workflows',
      'Browser automation',
      'Run history',
    ]);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Run history');
  });

  it('preserves dedicated conversation chrome', () => {
    renderAt('/chat/example');
    expect(container.textContent).toBe('Page title');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('preserves the extension app header instead of showing capability tabs', () => {
    renderAt('/extensions/example/dashboard');

    expect(container.textContent).toBe('Page title');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
