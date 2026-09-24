// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/shell/about-dialog', () => ({ AboutDialog: () => null }));
vi.mock('@/pages/settings-page', () => ({}));
vi.mock('@/pages/sessions-page', () => ({}));
vi.mock('@/pages/logs-page', () => ({}));
vi.mock('@/pages/automations-page', () => ({}));
vi.mock('@/features/capabilities/capabilities-page', () => ({}));

import { SidebarFooter } from '@/components/shell/sidebar-footer';

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
});

afterEach(() => {
  act(unmount);
  container.remove();
});

describe('sidebar menu surfaces', () => {
  it('uses opaque overlay surfaces for the app menu and its flyouts', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    act(() => {
      root.render(<MemoryRouter><SidebarFooter /></MemoryRouter>);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
      await Promise.resolve();
    });

    const appMenu = document.body.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]')?.firstElementChild;
    expect(appMenu?.className).toContain('bg-surface-overlay');
    expect(appMenu?.className).not.toContain('bg-surface-panel');

    const languageFlyout = appMenu?.querySelector<HTMLElement>('[role="menu"] > div');
    expect(languageFlyout?.className).toContain('bg-surface-overlay');
    expect(languageFlyout?.className).not.toContain('bg-surface-panel');
    expect(languageFlyout?.className).toContain('overflow-hidden');
    expect(languageFlyout?.className).not.toContain('p-1');

    const selectedOption = languageFlyout?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    expect(selectedOption?.className).toContain('rounded-none');
    expect(selectedOption?.className).toContain('px-3');
  });
});
