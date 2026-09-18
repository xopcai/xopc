// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

const { prepareAndOpen, setup } = vi.hoisted(() => {
  const prepareAndOpen = vi.fn(async () => {});
  return {
    prepareAndOpen,
    setup: {
      status: { localManagementAvailable: true },
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

import { BrowserSetupRequiredCard } from '@/features/chat/tool-results/browser-setup-required-card';

describe('BrowserSetupRequiredCard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    prepareAndOpen.mockClear();
    setup.installed = false;
    setup.error = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('prepares and opens Chrome directly for a local extension failure', async () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <BrowserSetupRequiredCard payload={{
            kind: 'browser_setup_required',
            driver: 'extension',
            reason: 'extension_not_installed',
            deepLink: '/settings/agent-browser?driver=extension',
          }} />
        </MemoryRouter>,
      );
    });

    const action = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Prepare and open Chrome'));
    expect(action).toBeDefined();
    await act(async () => action?.click());
    expect(prepareAndOpen).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Browser settings');
  });
});
