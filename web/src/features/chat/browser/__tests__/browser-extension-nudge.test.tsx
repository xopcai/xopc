// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

const { setup, prepareAndOpen } = vi.hoisted(() => {
  const prepareAndOpen = vi.fn(async () => {});
  return {
    prepareAndOpen,
    setup: {
      status: {
        enabled: true,
        driverKind: 'extension' as const,
        state: 'needs_attention',
        localManagementAvailable: true,
        driverStatus: { driverKind: 'extension' as const, connected: false },
      },
      setupState: 'not_installed',
      installed: false,
      busy: false,
      error: null as string | null,
      prepareAndOpen,
    },
  };
});

vi.mock('@/features/chat/browser/use-browser-extension-setup', () => ({
  useBrowserExtensionSetup: () => setup,
}));

import { BrowserExtensionNudge } from '@/features/chat/browser/browser-extension-nudge';

describe('BrowserExtensionNudge', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.setState({ language: 'en' });
    prepareAndOpen.mockClear();
    setup.status.state = 'needs_attention';
    setup.status.driverStatus.connected = false;
    setup.setupState = 'not_installed';
    setup.installed = false;
    setup.busy = false;
    setup.error = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('starts the local extension setup from the chat prompt', async () => {
    act(() => root.render(<BrowserExtensionNudge enabled />));

    expect(container.textContent).toContain('Let xopc use your signed-in Chrome');
    const install = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Install'));
    await act(async () => install?.click());
    expect(prepareAndOpen).toHaveBeenCalledOnce();
  });

  it('stays dismissed after the close action', () => {
    act(() => root.render(<BrowserExtensionNudge enabled />));
    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss browser extension setup"]',
    );
    act(() => dismiss?.click());

    expect(container.textContent).toBe('');
    expect(Number(localStorage.getItem('xopc:browser-extension-nudge:v1'))).toBeGreaterThan(0);

    act(() => root.render(<BrowserExtensionNudge key="remounted" enabled />));
    expect(container.textContent).toBe('');
  });

  it('does not render once Chrome is connected', () => {
    setup.status.state = 'ready';
    setup.status.driverStatus.connected = true;
    setup.setupState = 'connected';
    act(() => root.render(<BrowserExtensionNudge enabled />));
    expect(container.textContent).toBe('');
  });

  it('offers reconnection instead of installation when artifacts already exist', () => {
    setup.setupState = 'installed_not_connected';
    setup.installed = true;

    act(() => root.render(<BrowserExtensionNudge enabled />));

    expect(container.textContent).toContain('Reconnect the Chrome extension');
    expect(container.textContent).toContain('Reconnect');
    expect(container.textContent).not.toContain('Install');
  });
});
