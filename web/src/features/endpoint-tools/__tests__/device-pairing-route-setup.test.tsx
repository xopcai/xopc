// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevicePairingRouteSetup } from '../device-pairing-route-setup';
import { fetchTunnelStatus, patchTunnelConfig, provisionTunnelRegistrationKey, startTunnel } from '@/features/tunnel/tunnel-api';
import type { TunnelStatusResponse } from '@/features/tunnel/tunnel-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('@/features/tunnel/tunnel-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/tunnel/tunnel-api')>(),
  fetchTunnelStatus: vi.fn(),
  startTunnel: vi.fn(),
  patchTunnelConfig: vi.fn(),
  provisionTunnelRegistrationKey: vi.fn(),
}));

vi.mock('@/features/settings/oauth-authorization-window', () => ({
  reserveOAuthAuthorizationWindow: vi.fn(() => null),
  closeOAuthAuthorizationWindow: vi.fn(),
  openOAuthAuthorizationUrl: vi.fn(),
}));

let revalidate: () => Promise<unknown>;
function CacheControl() {
  const { mutate } = useSWRConfig();
  revalidate = () => mutate('tunnel-status');
  return null;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const copy = () => messages(useLocaleStore.getState().language).endpointToolsSettings.deviceAccess.flow;
const status = (state: TunnelStatusResponse['state']): TunnelStatusResponse => ({
  enabled: false, state, subdomain: null, publicUrl: null, connectedSince: null,
  frpcPid: null, lastHeartbeatAt: null, lastError: state === 'error' ? 'Broker unreachable' : null,
  consentRequired: false, registrationSecret: { configured: true, source: 'config' },
  config: { autoStart: false, brokerUrl: 'https://broker.example.com' },
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><CacheControl /><DevicePairingRouteSetup /></SWRConfig>);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.resetAllMocks();
});

describe('device pairing route recovery', () => {
  it('recovers the lease explicitly without replacing a valid registration key', async () => {
    vi.mocked(fetchTunnelStatus).mockResolvedValue({ ...status('error'), lastError: 'Active lease ownership proof required' });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(copy().routeRecoveryRequired);
    expect(container.querySelector('button')?.textContent).toBe(copy().recoverRoute);
    await act(async () => { container.querySelector('button')!.click(); });
    expect(startTunnel).toHaveBeenCalledWith({ recoverActiveLease: true });
    expect(provisionTunnelRegistrationKey).not.toHaveBeenCalled();
    expect(patchTunnelConfig).toHaveBeenCalledWith({ autoStart: true });
  });
  it('clears an earlier recovery failure when status confirms the gateway is connected', async () => {
    vi.mocked(fetchTunnelStatus).mockResolvedValue(status('disconnected'));
    vi.mocked(startTunnel).mockRejectedValueOnce(Object.assign(new Error('Active lease ownership proof required'), {
      body: { code: 'TUNNEL_RECOVERY_PROOF_REJECTED' },
    }));
    await render();
    await act(async () => { container.querySelector('button')!.click(); });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(fetchTunnelStatus).mockResolvedValue(status('connected'));
    await act(async () => { await revalidate(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(startTunnel).toHaveBeenCalledOnce();
  });

  it('replaces a rejected saved key before retrying instead of reusing it', async () => {
    vi.mocked(fetchTunnelStatus).mockResolvedValueOnce({ ...status('error'), lastError: 'Tunnel register failed: 401' })
      .mockResolvedValue(status('disconnected'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(copy().routeAuthorizationRequired);
    expect(container.querySelector('button')?.textContent).toBe(copy().authorize);
    await act(async () => { container.querySelector('button')!.click(); });
    expect(patchTunnelConfig).toHaveBeenNthCalledWith(1, { registrationSecret: null });
    expect(provisionTunnelRegistrationKey).toHaveBeenCalledOnce();
    expect(startTunnel).toHaveBeenCalledOnce();
    expect(vi.mocked(patchTunnelConfig).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(provisionTunnelRegistrationKey).mock.invocationCallOrder[0]);
    expect(vi.mocked(provisionTunnelRegistrationKey).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(startTunnel).mock.invocationCallOrder[0]);
  });

  it('offers authorization after a start request rejects the key', async () => {
    vi.mocked(fetchTunnelStatus).mockResolvedValue(status('disconnected'));
    vi.mocked(startTunnel).mockRejectedValueOnce(Object.assign(new Error('Registration rejected'), { body: { code: 'TUNNEL_REGISTRATION_KEY_REJECTED' } }));
    await render();
    await act(async () => { container.querySelector('button')!.click(); });
    expect(container.querySelector('button')?.textContent).toBe(copy().authorize);
    await act(async () => { container.querySelector('button')!.click(); });
    expect(provisionTunnelRegistrationKey).toHaveBeenCalledOnce();
    expect(startTunnel).toHaveBeenCalledTimes(2);
  });
  it('lets users reload a failed status request before enabling a connection', async () => {
    vi.mocked(fetchTunnelStatus).mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue(status('disconnected'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(copy().readinessFailed);
    const retry = container.querySelector('button')!;
    expect(retry.textContent).toBe(copy().retry);
    expect(retry.disabled).toBe(false);
    await act(async () => { retry.click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button')?.textContent).toBe(copy().enable);
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it('exposes the tunnel failure and retries starting the connection', async () => {
    vi.mocked(fetchTunnelStatus).mockResolvedValue(status('error'));
    vi.mocked(startTunnel).mockRejectedValueOnce(new Error('Connection timed out'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Broker unreachable');
    expect(container.querySelector('button')?.textContent).toBe(copy().retry);
    await act(async () => { container.querySelector('button')!.click(); });
    expect(startTunnel).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection timed out');
  });

  it('does not show a stale failure while the tunnel is reconnecting', async () => {
    vi.mocked(fetchTunnelStatus).mockResolvedValue({ ...status('reconnecting'), lastError: 'Previous failure' });
    await render();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button')?.disabled).toBe(true);
  });
});
