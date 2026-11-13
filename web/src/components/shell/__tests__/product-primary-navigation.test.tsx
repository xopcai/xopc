// @vitest-environment jsdom

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const extensionState = vi.hoisted(() => ({ unreadCount: 0, items: [] as Array<Record<string, unknown>> }));

vi.mock('@/features/personal-agent/use-personal-unread', () => ({
  usePersonalUnread: () => extensionState.unreadCount,
  personalUnreadLabel: (count: number) => count > 99 ? '99+' : String(count),
}));

vi.mock('@/features/extensions/extension-provider', () => ({
  useUiExtensions: () => extensionState.items,
}));

import { MobilePrimaryNav } from '@/components/shell/mobile-primary-nav';
import { SidebarNavItems } from '@/components/shell/sidebar-nav-items';
import { useNavOrderStore } from '@/stores/nav-order-store';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
  useNavOrderStore.getState().setOrder([]);
  localStorage.removeItem('xopc-web-sidebar-nav-order');
  extensionState.items.length = 0;
  extensionState.unreadCount = 0;
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
  it('places Space below Work by default', () => {
    renderAt('/projects/example', <SidebarNavItems />);

    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/personal',
      '/',
      '/space',
      '/capabilities/extensions',
      '/automations',
    ]);
    expect(container.querySelector('a[href="/"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('button[aria-label="More navigation items"]')?.className).not.toContain('bg-surface-active');
    openMore();
    expect(document.body.textContent).toContain('Apps');
    expect(document.body.querySelector('a[href="/local-apps"]')).not.toBeNull();
    for (const path of ['/projects', '/notes', '/capabilities/connectors', '/capabilities/skills']) {
      expect(document.body.querySelector(`a[href="${path}"]`)).toBeNull();
    }
  });

  it.each(['/capabilities/connectors/service', '/capabilities/agents/main', '/capabilities/channels/telegram', '/capabilities/extensions'])('keeps Capabilities active for %s', (path) => {
    renderAt(path, <SidebarNavItems />);
    expect(container.querySelector('a[href="/capabilities/extensions"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('a[href="/capabilities/extensions"]')?.textContent).toBe('Capabilities');
  });

  it.each([ '/automations/example'])('keeps Automations active for %s', (path) => {
    renderAt(path, <SidebarNavItems />);
    expect(container.querySelector('a[href="/automations"]')?.getAttribute('aria-current')).toBe('page');
  });

  it.each([1, 9, 99, 100, 123])('shows %i unread replies beside Personal AI', count => {
    extensionState.unreadCount = count;
    renderAt('/', <SidebarNavItems />);
    const badge = container.querySelector('a[href="/personal"] span[aria-label$="unread messages"]');
    expect(badge?.textContent).toBe(count > 99 ? '99+' : String(count));
  });

  it('shows the unread badge with collapsed navigation', () => {
    extensionState.unreadCount = 123;
    renderAt('/', <SidebarNavItems collapsed />);
    expect(container.querySelector('a[href="/personal"] span[aria-label$="unread messages"]')?.textContent).toBe('99+');
  });

  it('keeps Automations active while viewing its internal run history', () => {
    renderAt('/automations?view=activity', <SidebarNavItems />);

    openMore();
    const automationLink = document.body.querySelector<HTMLAnchorElement>('a[href="/automations"]');
    expect(automationLink?.getAttribute('aria-current')).toBe('page');
    expect(document.body.textContent).not.toContain('Run history');
  });

  it('shows all five shortcuts when the shortcut area expands', () => {
    renderAt('/', <SidebarNavItems visibleLimit={5} />);

    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/personal',
      '/',
      '/space',
      '/capabilities/extensions',
      '/automations',
      '/local-apps',
    ]);
    expect(container.querySelector('button[aria-label="More navigation items"]')).toBeNull();
  });

  it('allows the visible shortcut area to shrink to one item', () => {
    renderAt('/', <SidebarNavItems visibleLimit={1} />);

    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/personal', '/']);
    expect(container.querySelector('button[aria-label="More navigation items"]')).not.toBeNull();
  });

  it('uses the same domains and active rule on mobile', () => {
    renderAt('/capabilities/connectors', <MobilePrimaryNav />);

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(5);
    expect(links[2]?.getAttribute('aria-current')).toBe('page');
    expect(links[4]?.getAttribute('href')).toBe('/user-model');
  });

  it('keeps Me active as the fifth mobile destination', () => {
    renderAt('/user-model', <MobilePrimaryNav />);

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(5);
    expect(links[4]?.textContent).toBe('Me');
    expect(links[4]?.getAttribute('aria-current')).toBe('page');
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
    const more = openMore();
    expect(more.className).toContain('bg-surface-active');
    const extensionLink = document.body.querySelector<HTMLAnchorElement>('a[href="/extensions/sample-extension/dashboard"]');
    expect(extensionLink?.getAttribute('aria-current')).toBe('page');
    expect(extensionLink?.textContent).toBe('Sample dashboard');
    expect(document.body.textContent).toContain('Plugin apps');
    expect(document.body.textContent).not.toContain('Hidden page');
  });

  it('drags a plugin app out of More, persists its position, and moves it back', () => {
    extensionState.items.push({
      id: 'reading', activationEligible: true,
      ui: { contributions: { pages: [
        { id: 'list', title: 'Reading list', path: '/list', entrypoint: 'list.js', showInNav: true },
      ] } },
    });
    renderAt('/', <SidebarNavItems />);
    openMore();
    const plugin = document.body.querySelector<HTMLAnchorElement>('a[href="/extensions/reading/list"]')!;
    const work = container.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    };
    const drag = (element: Element, type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: -1 });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      act(() => element.dispatchEvent(event));
    };
    expect(plugin.draggable).toBe(true);
    drag(plugin, 'dragstart');
    drag(work, 'dragover');
    drag(work, 'drop');
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/personal', '/extensions/reading/list', '/', '/space', '/capabilities/extensions',
    ]);
    const saved = JSON.parse(localStorage.getItem('xopc-web-sidebar-nav-order')!);
    expect(saved[0]).toBe('ext:reading:list');

    act(unmount);
    container.remove();
    renderAt('/extensions/reading/list', <SidebarNavItems collapsed />);
    const pinned = container.querySelector<HTMLAnchorElement>('a[href="/extensions/reading/list"]')!;
    expect(pinned.getAttribute('aria-current')).toBe('page');
    drag(pinned, 'dragstart');
    const more = container.querySelector('button[aria-label="More navigation items"]')!;
    drag(more, 'dragover');
    drag(more, 'drop');
    expect(container.querySelector('a[href="/extensions/reading/list"]')).toBeNull();
    openMore();
    expect(document.body.querySelector('a[href="/extensions/reading/list"]')).not.toBeNull();
  });

  it('moves Space above Work and preserves its position on remount', () => {
    useNavOrderStore.getState().setOrder(['builtin:capabilities', 'builtin:work']);
    renderAt('/space', <SidebarNavItems />);
    const space = container.querySelector<HTMLAnchorElement>('a[href="/space"]')!;
    const work = container.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    expect(work.nextElementSibling).toBe(space);
    expect(space.draggable).toBe(true);
    expect(space.getAttribute('aria-current')).toBe('page');

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    };
    for (const [target, type] of [[space, 'dragstart'], [work, 'dragover'], [work, 'drop']] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: -1 });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      act(() => target.dispatchEvent(event));
    }
    expect(JSON.parse(localStorage.getItem('xopc-web-sidebar-nav-order')!).slice(0, 3))
      .toEqual(['builtin:capabilities', 'builtin:space', 'builtin:work']);

    act(unmount);
    container.remove();
    renderAt('/space', <SidebarNavItems collapsed />);
    expect(container.querySelector('a[href="/space"]')?.nextElementSibling?.getAttribute('href')).toBe('/');
  });

  it('ignores unrelated drops and safely reconciles unavailable and duplicate entries', () => {
    useNavOrderStore.getState().setOrder(['ext:missing:page', 'builtin:automations', 'builtin:automations']);
    renderAt('/', <SidebarNavItems />);
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/personal', '/automations', '/', '/space', '/capabilities/extensions',
    ]);
    const work = container.querySelector('a[href="/"]')!;
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { getData: () => 'builtin:localApps' } });
    act(() => work.dispatchEvent(event));
    expect(useNavOrderStore.getState().order).toEqual(['ext:missing:page', 'builtin:automations']);
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
