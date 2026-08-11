import { afterEach, describe, expect, it, vi } from 'vitest';

import { xopcCloudOAuthProvider } from './xopc-cloud.js';

const nativeFetch = globalThis.fetch;

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
      onSelect: async () => 'device_code',
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

  it('completes authorization code login with PKCE through a loopback callback', async () => {
    process.env.XOPC_CONSOLE_URL = 'https://console.test/';
    let authorizationUrl: URL | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
      expect(url.href).toBe('https://console.test/oauth/token');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('client_id')).toBe('xopc-native');
      expect(body.get('code')).toBe('authorization-code');
      expect(body.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);
      expect(body.get('redirect_uri')).toBe(authorizationUrl?.searchParams.get('redirect_uri'));
      return Response.json({
        access_token: 'browser-access-token',
        refresh_token: 'browser-refresh-token',
        expires_in: 900,
        scope: 'models:read models:invoke account:usage offline_access',
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const onAuth = vi.fn((info: { url: string }) => {
      authorizationUrl = new URL(info.url);
      expect(authorizationUrl.origin).toBe('https://console.test');
      expect(authorizationUrl.pathname).toBe('/oauth/authorize');
      expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')!;
      const callback = new URL(redirectUri);
      callback.searchParams.set('code', 'authorization-code');
      callback.searchParams.set('state', authorizationUrl.searchParams.get('state')!);
      void nativeFetch(callback);
    });

    await expect(xopcCloudOAuthProvider.login({
      onAuth,
      onDeviceCode: vi.fn(),
      onPrompt: async () => '',
      onSelect: async () => 'browser',
    })).resolves.toMatchObject({
      access: 'browser-access-token',
      refresh: 'browser-refresh-token',
    });
    expect(onAuth).toHaveBeenCalledOnce();
  });

  it('rejects a loopback callback with the wrong state', async () => {
    process.env.XOPC_CONSOLE_URL = 'https://console.test/';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => {
      const url = new URL(String(input));
      return url.hostname === '127.0.0.1'
        ? nativeFetch(input, init)
        : Promise.reject(new Error(`Unexpected request: ${url}`));
    }));

    await expect(xopcCloudOAuthProvider.login({
      onAuth: (info) => {
        const authorizationUrl = new URL(info.url);
        const callback = new URL(authorizationUrl.searchParams.get('redirect_uri')!);
        callback.searchParams.set('code', 'authorization-code');
        callback.searchParams.set('state', 'wrong-state');
        void nativeFetch(callback);
      },
      onDeviceCode: vi.fn(),
      onPrompt: async () => '',
      onSelect: async () => 'browser',
    })).rejects.toThrow('state mismatch');
  });

  it('does not start browser authorization when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by test'));

    await expect(xopcCloudOAuthProvider.login({
      onAuth: vi.fn(),
      onDeviceCode: vi.fn(),
      onPrompt: async () => '',
      onSelect: async () => 'browser',
      signal: controller.signal,
    })).rejects.toThrow('cancelled by test');
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
