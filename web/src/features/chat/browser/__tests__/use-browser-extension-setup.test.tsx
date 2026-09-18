// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';

const { fetchBrowserStatus, installBrowserExtension, openBrowserExtension } = vi.hoisted(() => ({
  fetchBrowserStatus: vi.fn(),
  installBrowserExtension: vi.fn(),
  openBrowserExtension: vi.fn(),
}));

vi.mock('@/features/settings/browser/browser-control-api', () => ({
  fetchBrowserStatus,
  installBrowserExtension,
  openBrowserExtension,
}));

import { useBrowserExtensionSetup } from '@/features/chat/browser/use-browser-extension-setup';

function Harness() {
  const setup = useBrowserExtensionSetup(true);
  return (
    <>
      <output>{setup.setupState}</output>
      <button type="button" disabled={!setup.status || setup.busy} onClick={() => void setup.prepareAndOpen()}>
        Prepare
      </button>
    </>
  );
}

describe('useBrowserExtensionSetup', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let cacheNamespace = 0;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    cacheNamespace += 1;
    useGatewayStore.setState({ conversationId: `browser-extension-test-${cacheNamespace}` });
    fetchBrowserStatus.mockResolvedValue({
      ok: true,
      payload: {
        enabled: true,
        driverKind: 'extension',
        state: 'needs_attention',
        localManagementAvailable: true,
        driverStatus: {
          driverKind: 'extension',
          connected: false,
          artifacts: { installed: false },
        },
      },
    });
    installBrowserExtension.mockResolvedValue({ ok: true });
    openBrowserExtension.mockResolvedValue({ ok: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('prepares missing artifacts before opening Chrome and the extension folder', async () => {
    act(() => root.render(<Harness />));
    await vi.waitFor(() => expect(container.querySelector('button')?.disabled).toBe(false));

    await act(async () => container.querySelector('button')?.click());

    expect(installBrowserExtension).toHaveBeenCalledWith(false);
    expect(openBrowserExtension).toHaveBeenCalledWith('both');
    expect(installBrowserExtension.mock.invocationCallOrder[0])
      .toBeLessThan(openBrowserExtension.mock.invocationCallOrder[0]);
  });

  it('reports installed artifacts separately from a live control connection', async () => {
    fetchBrowserStatus.mockResolvedValueOnce({
      ok: true,
      payload: {
        enabled: true,
        driverKind: 'extension',
        state: 'needs_attention',
        localManagementAvailable: true,
        driverStatus: {
          driverKind: 'extension',
          connected: false,
          setupState: 'installed_not_connected',
          artifacts: { installed: true },
        },
      },
    });

    act(() => root.render(<Harness />));
    await vi.waitFor(() => expect(container.querySelector('output')?.textContent)
      .toBe('installed_not_connected'));
  });
});
