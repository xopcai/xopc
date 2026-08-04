import { afterEach, describe, expect, it, vi } from 'vitest';

import { xopcCloudOAuthProvider } from './xopc-cloud.js';

describe('xopcCloudOAuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.XOPC_CONSOLE_URL;
  });

  it('uses the standard device authorization grant', async () => {
    vi.useFakeTimers();
    process.env.XOPC_CONSOLE_URL = 'https://console.test/';
    const onDeviceCode = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = new URLSearchParams(String(init?.body));
      if (url.endsWith('/oauth/device_authorization')) {
        expect(body.get('client_id')).toBe('xopc-native');
        expect(body.get('scope')).toContain('models:invoke');
        return Response.json({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://console.test/oauth/device',
          verification_uri_complete: 'https://console.test/oauth/device?user_code=ABCD-EFGH',
          expires_in: 600,
          interval: 1,
        });
      }
      expect(url).toBe('https://console.test/oauth/token');
      expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
      return Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 900,
        scope: 'models:read models:invoke offline_access',
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const login = xopcCloudOAuthProvider.login({
      onAuth: vi.fn(),
      onDeviceCode,
      onPrompt: async () => '',
      onSelect: async () => undefined,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(login).resolves.toMatchObject({
      access: 'access-token',
      refresh: 'refresh-token',
      scope: ['models:read', 'models:invoke', 'offline_access'],
    });
    expect(onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://console.test/oauth/device?user_code=ABCD-EFGH',
    }));
  });

  it('rotates refresh tokens through the standard refresh grant', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-token-1');
      return Response.json({
        access_token: 'access-token-2',
        refresh_token: 'refresh-token-2',
        expires_in: 900,
      });
    }));

    await expect(xopcCloudOAuthProvider.refreshToken({
      access: 'access-token-1',
      refresh: 'refresh-token-1',
      expires: Date.now(),
    })).resolves.toMatchObject({
      access: 'access-token-2',
      refresh: 'refresh-token-2',
    });
  });
});
