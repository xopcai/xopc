// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductSectionHeader } from '@/components/shell/product-section-header';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
});

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output>{location.pathname}</output><button aria-label="Go back" onClick={() => navigate(-1)}>Back</button></>;
}

function renderAt(path: string) {
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  unmount = () => root.unmount();
  act(() => root.render(
    <MemoryRouter initialEntries={[path]}>
      <ProductSectionHeader fallback={<span>Page title</span>} />
      <NavigationProbe />
    </MemoryRouter>,
  ));
}

describe('ProductSectionHeader', () => {
  it('keeps the same work section structure on list and detail routes', () => {
    renderAt('/projects/example');

    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Workbench',
      'Projects',
      'Notes',
    ]);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Projects');
  });

  it('keeps activity inside the Automations section', () => {
    renderAt('/automations?view=activity');

    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Automations');
    expect(container.textContent).toContain('Automations');
  });

  it('switches capability sections and restores selection on back', () => {
    renderAt('/capabilities/connectors');
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.textContent)).toEqual(['Plugins', 'Skills', 'Connections', 'Agents', 'Channels']);
    act(() => tabs[0].click());
    expect(container.querySelector('output')?.textContent).toBe('/capabilities/extensions');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('Plugins');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Go back"]')!.click());
    expect(container.querySelector('output')?.textContent).toBe('/capabilities/connectors');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('Connections');
  });

  it('offers the same sections in the compact picker', () => {
    renderAt('/workflows/example/edit');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Workflows');
    const picker = container.querySelector<HTMLButtonElement>('button[aria-label="Page sections"]')!;
    act(() => picker.click());
    const option = [...document.body.querySelectorAll<HTMLButtonElement>('[data-radix-popper-content-wrapper] button')]
      .find(button => button.textContent === 'Browser automation')!;
    act(() => option.click());
    expect(container.querySelector('output')?.textContent).toBe('/browser-automations');
    expect(picker.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves dedicated conversation chrome', () => {
    renderAt('/chat/example');
    expect(container.textContent).toContain('Page title');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('preserves the extension app header instead of showing capability tabs', () => {
    renderAt('/extensions/example/dashboard');

    expect(container.textContent).toContain('Page title');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
