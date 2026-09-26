// @vitest-environment jsdom

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const extensionState = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));

vi.mock('@/features/extensions/extension-provider', () => ({
  useUiExtensions: () => extensionState.items,
}));

import { MobilePrimaryNav } from '@/components/shell/mobile-primary-nav';
import { SidebarNavItems } from '@/components/shell/sidebar-nav-items';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
  extensionState.items.length = 0;
});

function renderAt(path: string, node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  unmount = () => root.unmount();
  act(() => root.render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>));
}

function openMore(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="More navigation items"]')!;
  act(() => button.click());
  return button;
}

describe('product primary navigation', () => {
  it('shows three primary destinations by default and groups the rest under More', () => {
    renderAt('/projects/example', <SidebarNavItems />);

    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/capabilities/skills',
      '/automations',
    ]);
    expect(container.textContent).not.toContain('Workflows');
    const more = openMore();
    expect(more.className).toContain('bg-surface-active');
    expect(document.body.querySelector<HTMLAnchorElement>('a[href="/projects"]')?.getAttribute('aria-current')).toBe('page');
    expect(document.body.textContent).toContain('Workflows');
    expect(document.body.textContent).toContain('Browser automation');
    expect(document.body.textContent).toContain('Capabilities');
    expect(document.body.textContent).toContain('Apps');
    expect(document.body.textContent).toContain('App Studio');
    expect(document.body.textContent).not.toContain('Run history');
  });

  it('keeps Automations active while viewing its internal run history', () => {
    renderAt('/automations?view=activity', <SidebarNavItems />);

    openMore();
    const automationLink = document.body.querySelector<HTMLAnchorElement>('a[href="/automations"]');
    expect(automationLink?.getAttribute('aria-current')).toBe('page');
    expect(document.body.textContent).not.toContain('Run history');
  });

  it('allows the visible shortcut area to grow to five items', () => {
    renderAt('/', <SidebarNavItems visibleLimit={5} />);

    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/capabilities/skills',
      '/automations',
      '/capabilities/connectors',
      '/projects',
    ]);
  });

  it('allows the visible shortcut area to shrink to one item', () => {
    renderAt('/', <SidebarNavItems visibleLimit={1} />);

    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/']);
    expect(container.querySelector('button[aria-label="More navigation items"]')).not.toBeNull();
  });

  it('uses the same domains and active rule on mobile', () => {
    renderAt('/capabilities/connectors', <MobilePrimaryNav />);

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(4);
    expect(links[2]?.getAttribute('aria-current')).toBe('page');
  });

  it('appends installed extension pages that opt into sidebar navigation', () => {
    extensionState.items.push({
      id: 'sample-extension',
      name: 'Sample extension',
      source: 'local',
      active: true,
      activationEligible: true,
      hasUi: true,
      ui: {
        contributions: {
          pages: [
            { id: 'dashboard', title: 'Sample dashboard', path: '/dashboard', entrypoint: 'dashboard.js', showInNav: true, navIcon: 'sparkles' },
            { id: 'hidden', title: 'Hidden page', path: '/hidden', entrypoint: 'hidden.js', showInNav: false },
          ],
        },
      },
    });

    renderAt('/extensions/sample-extension/dashboard', <SidebarNavItems />);

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(3);
    const more = openMore();
    expect(more.className).toContain('bg-surface-active');
    const extensionLink = document.body.querySelector<HTMLAnchorElement>('a[href="/extensions/sample-extension/dashboard"]');
    expect(extensionLink?.getAttribute('aria-current')).toBe('page');
    expect(extensionLink?.textContent).toBe('Sample dashboard');
    expect(document.body.textContent).toContain('Extension apps');
    expect(document.body.textContent).not.toContain('Hidden page');
  });

  it('hides extension pages disabled pending a gateway restart', () => {
    extensionState.items.push({
      id: 'disabled-extension',
      name: 'Disabled extension',
      source: 'local',
      active: true,
      activationEligible: false,
      hasUi: true,
      ui: {
        contributions: {
          pages: [{ id: 'dashboard', title: 'Disabled dashboard', path: '/dashboard', entrypoint: 'dashboard.js', showInNav: true }],
        },
      },
    });

    renderAt('/', <SidebarNavItems />);

    openMore();
    expect(document.body.textContent).not.toContain('Disabled dashboard');
  });

  it('keeps extension pages available in the More group', () => {
    extensionState.items.push({
      id: 'many-pages',
      name: 'Many pages',
      source: 'local',
      active: true,
      activationEligible: true,
      hasUi: true,
      ui: {
        contributions: {
          pages: [
            { id: 'one', title: 'Extension one', path: '/one', entrypoint: 'one.js', showInNav: true },
            { id: 'two', title: 'Extension two', path: '/two', entrypoint: 'two.js', showInNav: true },
          ],
        },
      },
    });

    renderAt('/', <SidebarNavItems />);

    expect(container.textContent).not.toContain('Extension one');
    openMore();
    expect(document.body.textContent).toContain('Extension one');
    expect(document.body.textContent).toContain('Extension two');
  });
});
