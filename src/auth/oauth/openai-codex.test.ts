import { afterEach, describe, expect, it, vi } from 'vitest';

import { openaiCodexOAuthProvider } from './openai-codex.js';

function accessToken(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url');
  return `header.${payload}.signature`;
}

describe('openaiCodexOAuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses device code authentication for remote or headless login', async () => {
    const onDeviceCode = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/accounts/deviceauth/usercode')) {
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toEqual({ client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' });
        return Response.json({
          device_auth_id: 'device-auth-id',
          user_code: 'ABCD-1234',
          interval: '5',
        });
      }
      if (url.endsWith('/api/accounts/deviceauth/token')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          device_auth_id: 'device-auth-id',
          user_code: 'ABCD-1234',
        });
        return Response.json({
          authorization_code: 'authorization-code',
          code_verifier: 'device-code-verifier',
          code_challenge: 'device-code-challenge',
        });
      }
      expect(url).toBe('https://auth.openai.com/oauth/token');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('authorization-code');
      expect(body.get('code_verifier')).toBe('device-code-verifier');
      expect(body.get('redirect_uri')).toBe('https://auth.openai.com/deviceauth/callback');
      return Response.json({
        access_token: accessToken('account-1'),
        refresh_token: 'refresh-token',
        expires_in: 3_600,
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    await expect(openaiCodexOAuthProvider.login({
      onAuth: vi.fn(),
      onDeviceCode,
      onPrompt: async () => '',
      onSelect: async () => 'device_code',
    })).resolves.toMatchObject({
      refresh: 'refresh-token',
      accountId: 'account-1',
    });
    expect(onDeviceCode).toHaveBeenCalledWith({
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.openai.com/codex/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
  });

  it('explains how to enable device code authentication when unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({}, { status: 404 })));

    await expect(openaiCodexOAuthProvider.login({
      onAuth: vi.fn(),
      onDeviceCode: vi.fn(),
      onPrompt: async () => '',
      onSelect: async () => 'device_code',
    })).rejects.toThrow('Enable it in ChatGPT security or workspace settings');
  });
});
