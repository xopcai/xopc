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

  it('falls back to the stored credential when the Electron gateway is not embedded', async () => {
    localStorage.setItem('xopc.token', 'dev-gateway-token');
    window.electronAPI = {
      gateway: { getCredential: vi.fn().mockResolvedValue(undefined) },
    } as unknown as ElectronAPI;

    initGatewayFromWindow();
    await Promise.resolve();

    expect(useGatewayStore.getState().token).toBe('dev-gateway-token');
  });

  it('falls back to the stored credential when a dev preload has no credential bridge', () => {
    localStorage.setItem('xopc.token', 'stored-token');
    window.electronAPI = { gateway: {} } as unknown as ElectronAPI;

    initGatewayFromWindow();

    expect(useGatewayStore.getState().token).toBe('stored-token');
  });
});
