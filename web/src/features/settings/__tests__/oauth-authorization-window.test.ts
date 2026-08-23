// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ElectronAPI } from '@/types/electron';

import {
  closeOAuthAuthorizationWindow,
  openOAuthAuthorizationUrl,
  reserveOAuthAuthorizationWindow,
} from '../oauth-authorization-window';

describe('OAuth authorization window', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it('reserves a browser popup while the click gesture is active', () => {
    const popup = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);

    expect(reserveOAuthAuthorizationWindow()).toBe(popup);
    expect(open).toHaveBeenCalledWith('about:blank', 'xopc-oauth');
    expect(popup.opener).toBeNull();
  });

  it('navigates the reserved browser popup when the authorization URL arrives', async () => {
    const replace = vi.fn();
    const popup = { closed: false, location: { replace } } as unknown as Window;

    await expect(openOAuthAuthorizationUrl('https://console.xopc.ai/oauth/authorize', popup))
      .resolves.toBe(true);
    expect(replace).toHaveBeenCalledWith('https://console.xopc.ai/oauth/authorize');
  });

  it('opens the system browser in Electron', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ ok: true as const });
    window.electronAPI = {
      shell: { openExternalUrl },
    } as unknown as ElectronAPI;

    expect(reserveOAuthAuthorizationWindow()).toBeNull();
    await expect(openOAuthAuthorizationUrl('https://console.xopc.ai/oauth/authorize', null))
      .resolves.toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith('https://console.xopc.ai/oauth/authorize');
  });

  it('closes an unused reserved popup', () => {
    const close = vi.fn();
    const popup = { closed: false, close } as unknown as Window;

    closeOAuthAuthorizationWindow(popup);
    expect(close).toHaveBeenCalledOnce();
  });
});
