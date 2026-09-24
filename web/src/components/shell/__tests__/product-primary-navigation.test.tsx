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

describe('product primary navigation', () => {
  it('renders only the four fixed desktop product domains', () => {
    renderAt('/projects/example', <SidebarNavItems />);

    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/automations',
      '/capabilities/skills',
      '/local-apps',
    ]);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(container.textContent).not.toContain('工作流');
    expect(container.textContent).not.toContain('浏览器自动化');
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
    expect(links).toHaveLength(5);
    expect(links[4]?.getAttribute('href')).toBe('/extensions/sample-extension/dashboard');
    expect(links[4]?.getAttribute('aria-current')).toBe('page');
    expect(links[2]?.getAttribute('aria-current')).toBeNull();
    expect(links[4]?.textContent).toBe('Sample dashboard');
    expect(container.textContent).not.toContain('Hidden page');
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

    expect(container.querySelectorAll('a')).toHaveLength(4);
    expect(container.textContent).not.toContain('Disabled dashboard');
  });

  it('moves extra extension pages into More instead of overflowing the sidebar', () => {
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

    expect(container.querySelectorAll('a')).toHaveLength(5);
    expect(container.textContent).toContain('Extension one');
    expect(container.textContent).not.toContain('Extension two');
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="More navigation items"]')).not.toBeNull();
  });
});
