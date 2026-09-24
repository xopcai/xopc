// @vitest-environment jsdom

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { MobilePrimaryNav } from '@/components/shell/mobile-primary-nav';
import { SidebarNavItems } from '@/components/shell/sidebar-nav-items';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
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
      '/automations?view=activity',
      '/capabilities/discover',
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
});
