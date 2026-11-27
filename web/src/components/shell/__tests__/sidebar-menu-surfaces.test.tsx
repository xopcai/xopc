// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/shell/about-dialog', () => ({ AboutDialog: () => null }));
vi.mock('@/features/endpoint-tools/device-pairing-wizard', () => ({
  DevicePairingWizard: ({ targetKind }: { targetKind?: string }) => (
    <div data-testid="device-pairing-wizard" data-target-kind={targetKind ?? ''} />
  ),
}));
vi.mock('@/features/endpoint-tools/device-access-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/endpoint-tools/device-access-api')>(),
  fetchDevicePairingReadiness: vi.fn(),
}));
vi.mock('@/pages/settings-page', () => ({}));
vi.mock('@/pages/sessions-page', () => ({}));
vi.mock('@/pages/logs-page', () => ({}));
vi.mock('@/pages/automations-page', () => ({}));
vi.mock('@/features/capabilities/capabilities-page', () => ({}));

import { SidebarFooter } from '@/components/shell/sidebar-footer';
import { fetchDevicePairingReadiness } from '@/features/endpoint-tools/device-access-api';
import { useGatewayStore } from '@/stores/gateway-store';

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
  useGatewayStore.setState({ conversationId: '' });
  window.localStorage.removeItem('xopc-sidebar-mobile-promo-dismissed-v1');
  vi.clearAllMocks();
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

  it('opens device pairing from the app menu', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    act(() => {
      root.render(<MemoryRouter><SidebarFooter /></MemoryRouter>);
    });

    expect(container.querySelector('button[aria-label*="Notifications"], button[aria-label*="通知"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
    });

    const appMenu = document.body.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]')?.firstElementChild;
    const connectDevice = Array.from(appMenu?.querySelectorAll('button') ?? []).find((button) =>
      /Connect device|连接设备/.test(button.textContent ?? ''),
    );
    expect(connectDevice).toBeDefined();

    await act(async () => {
      connectDevice?.click();
      await Promise.resolve();
    });

    expect(document.body.querySelector('[data-testid="device-pairing-wizard"]')).not.toBeNull();
  });

  it('shows a dismissible mobile pairing entry when authenticated with no paired phones', async () => {
    useGatewayStore.setState({ conversationId: 'token-123' });
    vi.mocked(fetchDevicePairingReadiness).mockResolvedValue({
      protocolVersion: 3,
      ready: true,
      routes: [],
      devices: {
        mobileCount: 0,
        mobileOnlineCount: 0,
        localBrowserConnected: false,
        browserConnectedCount: 0,
        remoteBrowserConnectedCount: 0,
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
            <SidebarFooter />
          </SWRConfig>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const promoBtn = Array.from(container.querySelectorAll('button')).find((button) =>
      /Use xopc on your phone|在手机上使用 xopc/.test(button.textContent ?? ''),
    );
    expect(promoBtn).toBeDefined();

    await act(async () => {
      promoBtn?.click();
      await Promise.resolve();
    });

    const wizard = document.body.querySelector<HTMLElement>('[data-testid="device-pairing-wizard"]');
    expect(wizard).not.toBeNull();
    expect(wizard?.dataset.targetKind).toBe('mobile');

    const dismissBtn = container.querySelector<HTMLButtonElement>('button[aria-label*="Dismiss mobile"], button[aria-label*="关闭手机"]');
    expect(dismissBtn).not.toBeNull();
    await act(async () => {
      dismissBtn?.click();
    });
    expect(window.localStorage.getItem('xopc-sidebar-mobile-promo-dismissed-v1')).toBe('1');
    expect(Array.from(container.querySelectorAll('button')).find((button) =>
      /Use xopc on your phone|在手机上使用 xopc/.test(button.textContent ?? ''),
    )).toBeUndefined();
  });

  it('hides the mobile promo when a phone is already connected and shows connected count in menu', async () => {
    useGatewayStore.setState({ conversationId: 'token-123' });
    vi.mocked(fetchDevicePairingReadiness).mockResolvedValue({
      protocolVersion: 3,
      ready: true,
      routes: [],
      devices: {
        mobileCount: 1,
        mobileOnlineCount: 1,
        localBrowserConnected: true,
        browserConnectedCount: 1,
        remoteBrowserConnectedCount: 0,
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
            <SidebarFooter />
          </SWRConfig>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(Array.from(container.querySelectorAll('button')).find((button) =>
      /Use xopc on your phone|在手机上使用 xopc/.test(button.textContent ?? ''),
    )).toBeUndefined();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
    });
    const appMenu = document.body.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]')?.firstElementChild;
    expect(appMenu?.textContent).toMatch(/2 connected|2 台已连/);
  });
});
