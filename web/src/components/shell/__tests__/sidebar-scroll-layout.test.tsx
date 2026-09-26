// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/shell/sidebar-footer', () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}));

vi.mock('@/features/extensions/extension-provider', () => ({
  useUiExtensions: () => [],
}));

vi.mock('@/components/shell/sidebar-task-list', () => ({
  SidebarTaskList: ({ scrollHeader }: { scrollHeader?: ReactNode }) => (
    <div data-testid="sidebar-scroll-region">
      {scrollHeader}
      <div data-testid="session-list" />
    </div>
  ),
}));

import { SidebarNav } from '@/components/shell/sidebar';

let container: HTMLDivElement;
let unmount: () => void;

afterEach(() => {
  act(unmount);
  container.remove();
  localStorage.clear();
});

describe('sidebar scroll layout', () => {
  it('keeps new chat sticky while menu links and sessions share one scroll region', () => {
    container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    act(() => {
      root.render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    });

    const scrollRegion = container.querySelector<HTMLElement>('[data-testid="sidebar-scroll-region"]');
    const newChat = scrollRegion?.querySelector<HTMLAnchorElement>('a[href="/chat/new"]');
    const menu = scrollRegion?.querySelector<HTMLElement>('nav[aria-label="Main"]');
    const inactiveMenuLink = [...(menu?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]
      .find((link) => !link.hasAttribute('aria-current'));
    const sessionList = scrollRegion?.querySelector<HTMLElement>('[data-testid="session-list"]');

    expect(scrollRegion).not.toBeNull();
    expect(newChat?.parentElement?.className).toContain('sticky');
    expect(newChat?.parentElement?.className).toContain('app-sidebar-sticky-surface');
    expect(newChat?.parentElement?.className).not.toContain('bg-surface-rail');
    expect(newChat?.parentElement?.className).not.toContain('border-b');
    expect(scrollRegion?.querySelector('.bg-edge-subtle')).toBeNull();
    expect(scrollRegion?.querySelector('[role="separator"] span')?.className).toContain('bg-transparent');
    expect(scrollRegion?.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('3');
    expect(scrollRegion?.querySelectorAll('nav[aria-label="Main"] a')).toHaveLength(3);
    expect(newChat?.className).toContain('leading-6');
    expect(newChat?.className).toContain('text-fg-muted');
    expect(newChat?.className).toContain('md:py-1.5');
    expect(inactiveMenuLink?.className).toContain('leading-6');
    expect(inactiveMenuLink?.className).toContain('text-fg-muted');
    expect(inactiveMenuLink?.className).toContain('md:py-1.5');
    expect(menu).not.toBeNull();
    expect(sessionList).not.toBeNull();
    const menuBeforeSessions = menu && sessionList
      ? menu.compareDocumentPosition(sessionList) & Node.DOCUMENT_POSITION_FOLLOWING
      : 0;
    expect(menuBeforeSessions).toBeTruthy();
    expect(container.querySelector('[data-testid="sidebar-footer"]')).not.toBeNull();
  });

  it('allows the shortcut area to expand from three to five with the keyboard', () => {
    container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    act(() => {
      root.render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    });

    const separator = container.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));

    expect(separator.getAttribute('aria-valuenow')).toBe('5');
    expect(container.querySelectorAll('nav[aria-label="Main"] a')).toHaveLength(5);
  });
});
