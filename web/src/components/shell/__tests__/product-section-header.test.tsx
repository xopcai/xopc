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
      'Tasks',
      'Projects',
      'Notes',
    ]);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Projects');
  });

  it('shows the Tasks section on /tasks and hides section tabs on task detail routes', () => {
    renderAt('/tasks');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Tasks');
    act(unmount);
    container.remove();
    renderAt('/tasks/task-123');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('keeps activity inside the Automations section', () => {
    renderAt('/automations?view=activity');

    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Automations');
    expect(container.textContent).toContain('Automations');
  });

  it('switches capability sections and restores selection on back', () => {
    renderAt('/capabilities/connectors');
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.textContent)).toEqual(['Plugins', 'Skills', 'Connections', 'Devices', 'Agents', 'Channels']);
    act(() => tabs[3].click());
    expect(container.querySelector('output')?.textContent).toBe('/capabilities/devices');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('Devices');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Go back"]')!.click());
    expect(container.querySelector('output')?.textContent).toBe('/capabilities/connectors');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('Connections');
  });

  it('does not offer the removed browser automation section', () => {
    renderAt('/automations');
    expect(container.textContent).not.toContain('Browser automation');
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
