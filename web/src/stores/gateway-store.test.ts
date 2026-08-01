// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ElectronAPI } from '@/types/electron';

import { initGatewayFromWindow, useGatewayStore } from './gateway-store';

describe('initGatewayFromWindow', () => {
  afterEach(() => {
    localStorage.clear();
    delete window.electronAPI;
    useGatewayStore.setState({ token: undefined, tokenDialogOpen: false, tokenExpired: false });
    vi.restoreAllMocks();
  });

  it('hydrates the embedded credential before initialization completes', async () => {
    window.electronAPI = {
      gateway: { getCredential: vi.fn().mockResolvedValue('embedded-token') },
    } as unknown as ElectronAPI;

    await initGatewayFromWindow();

    expect(useGatewayStore.getState().token).toBe('embedded-token');
  });

  it('falls back to the stored credential when the Electron gateway is not embedded', async () => {
    localStorage.setItem('xopc.token', 'dev-gateway-token');
    window.electronAPI = {
      gateway: { getCredential: vi.fn().mockResolvedValue(undefined) },
    } as unknown as ElectronAPI;

    await initGatewayFromWindow();

    expect(useGatewayStore.getState().token).toBe('dev-gateway-token');
  });

  it('falls back to the stored credential when a dev preload has no credential bridge', async () => {
    localStorage.setItem('xopc.token', 'stored-token');
    window.electronAPI = { gateway: {} } as unknown as ElectronAPI;

    await initGatewayFromWindow();

    expect(useGatewayStore.getState().token).toBe('stored-token');
  });
});
