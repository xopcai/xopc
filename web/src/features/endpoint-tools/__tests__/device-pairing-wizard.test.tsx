// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import {
  cancelDevicePairingSetup,
  createDevicePairingSetup,
  fetchDevicePairingReadiness,
  type DevicePairingReadiness,
} from '../device-access-api';
import {
  fetchBrowserExtensionStatus,
  installBrowserExtension,
  openBrowserExtension,
} from '@/features/settings/browser/browser-control-api';
import { DevicePairingWizard } from '../device-pairing-wizard';

vi.mock('../device-access-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../device-access-api')>(),
  fetchDevicePairingReadiness: vi.fn(),
  createDevicePairingSetup: vi.fn(),
  cancelDevicePairingSetup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/settings/browser/browser-control-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/settings/browser/browser-control-api')>(),
  fetchBrowserExtensionStatus: vi.fn(),
  installBrowserExtension: vi.fn(),
  openBrowserExtension: vi.fn(),
}));

vi.mock('../device-pairing-route-setup', () => ({
  DevicePairingRouteSetup: () => <div data-testid="route-setup-mock" />,
}));

vi.mock('@/features/tunnel/mobile-pair-qr', () => ({
  encodeMobilePairQr: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderWizard(readiness: DevicePairingReadiness) {
  vi.mocked(fetchDevicePairingReadiness).mockResolvedValue(readiness);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
          <DevicePairingWizard open onOpenChange={() => {}} />
        </SWRConfig>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('DevicePairingWizard chooser & state awareness', () => {
  it('prioritizes Phone, shows local Chrome second, and demotes remote Chrome when local Chrome is not connected', async () => {
    const copy = messages(useLocaleStore.getState().language).endpointToolsSettings.deviceAccess;
    await renderWizard({
      protocolVersion: 3,
      ready: false,
      routes: [],
      devices: {
        mobileCount: 0,
        mobileOnlineCount: 0,
        localBrowserConnected: false,
        browserConnectedCount: 0,
        remoteBrowserConnectedCount: 0,
      },
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const text = dialog?.textContent ?? '';
    expect(text).toContain(copy.recommendedBadge);
    expect(text).toContain(copy.localBrowserTitle);
    expect(text).toContain(copy.remoteBrowserFooterAction);
    expect(text).not.toContain(copy.localBrowserConnected);

    // Phone card appears before local Chrome card.
    const mobileIdx = text.indexOf(copy.mobileTitle);
    const localIdx = text.indexOf(copy.localBrowserTitle);
    expect(mobileIdx).toBeGreaterThan(-1);
    expect(localIdx).toBeGreaterThan(mobileIdx);

    // Clicking Phone enters route setup with the 2-step indicator and a Back button.
    const phoneBtn = Array.from(dialog?.querySelectorAll('button') ?? []).find((btn) =>
      btn.textContent?.includes(copy.mobileTitle),
    );
    expect(phoneBtn).toBeDefined();
    await act(async () => {
      phoneBtn?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(copy.stepSetupRoute);
    expect(document.body.textContent).toContain(copy.stepMobileScan);
    expect(document.body.querySelector('[data-testid="route-setup-mock"]')).not.toBeNull();

    const backBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((btn) =>
      btn.textContent?.trim() === copy.flow.back,
    );
    expect(backBtn).toBeDefined();
    await act(async () => {
      backBtn?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain(copy.chooseTitle);
    expect(createDevicePairingSetup).not.toHaveBeenCalled();
    expect(cancelDevicePairingSetup).not.toHaveBeenCalled();
  });

  it('demotes local Chrome into a quiet connected footer bar once local Chrome is connected', async () => {
    const copy = messages(useLocaleStore.getState().language).endpointToolsSettings.deviceAccess;
    await renderWizard({
      protocolVersion: 3,
      ready: true,
      routes: [{ id: 'r1', kind: 'xopc-secure-link', url: 'https://demo.frp.xopc.ai' }],
      devices: {
        mobileCount: 1,
        mobileOnlineCount: 1,
        localBrowserConnected: true,
        browserConnectedCount: 1,
        remoteBrowserConnectedCount: 0,
      },
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    const text = dialog?.textContent ?? '';
    expect(text).toContain(copy.connectedCountBadge.replace('{{count}}', '1'));
    expect(text).toContain(copy.remoteBrowserTitle);
    expect(text).toContain(copy.localBrowserConnected);
    expect(text).toContain(copy.manageBrowser);
    expect(text).not.toContain(copy.recommendedBadge);
    expect(text).not.toContain(copy.remoteBrowserFooterAction);
  });

  it('completes local Chrome preparation and opening inside the modal without leaving the page', async () => {
    const copy = messages(useLocaleStore.getState().language).endpointToolsSettings.deviceAccess;
    vi.mocked(fetchBrowserExtensionStatus)
      .mockResolvedValueOnce({
        running: true,
        socketConnected: false,
        connected: false,
        localConnected: false,
        localManagementAvailable: true,
        driverKind: 'extension',
        protocolVersion: null,
        expectedProtocolVersion: 3,
        extensionVersion: null,
        artifacts: { installed: false, bundledAvailable: true, needsRefresh: false, nativeHost: { installed: false, manifestPaths: [] } },
      })
      .mockResolvedValue({
        running: true,
        socketConnected: false,
        connected: false,
        localConnected: false,
        localManagementAvailable: true,
        driverKind: 'extension',
        protocolVersion: null,
        expectedProtocolVersion: 3,
        extensionVersion: null,
        artifacts: {
          installed: true,
          bundledAvailable: true,
          extensionDir: '/tmp/xopc-ext',
          needsRefresh: false,
          nativeHost: { installed: true, manifestPaths: ['/tmp/host.json'] },
        },
      });
    vi.mocked(installBrowserExtension).mockResolvedValue({
      ok: true,
      payload: {
        extensionDir: '/tmp/xopc-ext',
        xopcVersion: '1.0.0',
        copied: true,
        nativeHost: { installed: true, manifestPaths: ['/tmp/host.json'] },
        doctor: { installed: true, bundledAvailable: true, needsRefresh: false },
      },
    });
    vi.mocked(openBrowserExtension).mockResolvedValue({ ok: true, payload: { extensionDir: '/tmp/xopc-ext', browser: 'chrome' } });

    await renderWizard({
      protocolVersion: 3,
      ready: false,
      routes: [],
      devices: {
        mobileCount: 0,
        mobileOnlineCount: 0,
        localBrowserConnected: false,
        browserConnectedCount: 0,
        remoteBrowserConnectedCount: 0,
      },
    });

    const localChromeBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((btn) =>
      btn.textContent?.includes(copy.localBrowserTitle),
    );
    expect(localChromeBtn).toBeDefined();
    await act(async () => {
      localChromeBtn?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(copy.localBrowserFlowTitle);
    const prepareBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((btn) =>
      btn.textContent?.includes(copy.localBrowserPrepareAction),
    );
    expect(prepareBtn).toBeDefined();
    await act(async () => {
      prepareBtn?.click();
      await Promise.resolve();
    });
    expect(installBrowserExtension).toHaveBeenCalledWith(false);

    const openChromeBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((btn) =>
      btn.textContent?.includes(copy.localBrowserOpenChrome),
    );
    expect(openChromeBtn).toBeDefined();
    await act(async () => {
      openChromeBtn?.click();
      await Promise.resolve();
    });
    expect(openBrowserExtension).toHaveBeenCalledWith('chrome');
    expect(document.body.textContent).toContain(copy.localBrowserOpenedNotice);
  });

  it('guides remote console sessions to one-time invitation when local Chrome management is unavailable', async () => {
    const copy = messages(useLocaleStore.getState().language).endpointToolsSettings.deviceAccess;
    vi.mocked(fetchBrowserExtensionStatus).mockResolvedValue({
      running: true,
      socketConnected: false,
      connected: false,
      localConnected: false,
      localManagementAvailable: false,
      driverKind: 'extension',
      protocolVersion: null,
      expectedProtocolVersion: 3,
      extensionVersion: null,
    });

    await renderWizard({
      protocolVersion: 3,
      ready: true,
      routes: [{ id: 'r1', kind: 'xopc-secure-link', url: 'https://demo.frp.xopc.ai' }],
      devices: {
        mobileCount: 0,
        mobileOnlineCount: 0,
        localBrowserConnected: false,
        browserConnectedCount: 0,
        remoteBrowserConnectedCount: 0,
      },
    });

    const localChromeBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((btn) =>
      btn.textContent?.includes(copy.localBrowserTitle),
    );
    await act(async () => {
      localChromeBtn?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(copy.localBrowserRemoteOnlyHint);
    const switchBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((btn) =>
      btn.textContent?.includes(copy.localBrowserSwitchRemote),
    );
    expect(switchBtn).toBeDefined();
    await act(async () => {
      switchBtn?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain(copy.browserPrepareTitle);
  });
});
