// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@/types/electron';
import { initGatewayFromWindow, useGatewayStore } from './gateway-store';

describe('HttpOnly browser session bootstrap', () => {
  afterEach(() => { localStorage.clear(); delete window.electronAPI; useGatewayStore.setState({ conversationId: undefined }); vi.unstubAllGlobals(); });
  it('restores an existing cookie session without requesting the owner credential', async () => {
    const getCredential = vi.fn();
    window.electronAPI = { gateway: { getCredential } } as unknown as ElectronAPI;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ conversationId: 'browser:session' })));
    await initGatewayFromWindow();
    expect(useGatewayStore.getState().conversationId).toBe('browser:session'); expect(getCredential).not.toHaveBeenCalled();
  });
  it('exchanges the embedded credential without persisting it or using it as a cache key', async () => {
    window.electronAPI = { gateway: { getCredential: vi.fn().mockResolvedValue('embedded-secret') } } as unknown as ElectronAPI;
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(Response.json({ conversationId: 'browser:session' }));
    vi.stubGlobal('fetch', fetch); await initGatewayFromWindow();
    expect(useGatewayStore.getState().conversationId).toBe('browser:session');
    expect(localStorage.getItem('xopc.token')).toBeNull();
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer embedded-secret');
  });
  it('does not exchange a retired LocalStorage credential', async () => {
    localStorage.setItem('xopc.token', 'stored-secret');
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch); await initGatewayFromWindow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(useGatewayStore.getState().conversationId).toBeUndefined();
    expect(JSON.stringify(useGatewayStore.getState())).not.toContain('stored-secret');
  });
});
