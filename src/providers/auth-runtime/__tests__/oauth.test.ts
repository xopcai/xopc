import { describe, expect, it, vi } from 'vitest';

import { isOAuthAccessTokenExpired, refreshOAuthProfile } from '../oauth.js';
import type { AuthProfile } from '../types.js';

const baseOauth: AuthProfile = {
  provider: 'openai',
  profileId: 'codex',
  mode: 'oauth',
  oauthAccessToken: 'old-access',
  oauthRefreshToken: 'r-old',
  oauthTokenEndpoint: 'https://example.test/token',
  oauthClientId: 'client-1',
  expiresAt: Date.now() + 60_000,
};

describe('isOAuthAccessTokenExpired', () => {
  it('returns false for non-oauth profiles', () => {
    expect(
      isOAuthAccessTokenExpired({ ...baseOauth, mode: 'api-key', expiresAt: 0 } as AuthProfile),
    ).toBe(false);
  });

  it('returns false when expiresAt is unknown (0 / missing)', () => {
    expect(isOAuthAccessTokenExpired({ ...baseOauth, expiresAt: 0 })).toBe(false);
    const { expiresAt: _drop, ...without } = baseOauth;
    expect(isOAuthAccessTokenExpired(without as AuthProfile)).toBe(false);
  });

  it('treats tokens within the 60s skew window as expired', () => {
    const now = Date.now();
    expect(isOAuthAccessTokenExpired({ ...baseOauth, expiresAt: now + 30_000 }, now)).toBe(true);
    expect(isOAuthAccessTokenExpired({ ...baseOauth, expiresAt: now + 120_000 }, now)).toBe(false);
  });
});

describe('refreshOAuthProfile', () => {
  it('returns a new profile with the refreshed access token + expiry', async () => {
    const fakeFetch: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'r-new',
          expires_in: 3600,
        }),
      }) as unknown as Response;

    const fresh = await refreshOAuthProfile(baseOauth, { fetcher: fakeFetch });
    expect(fresh.oauthAccessToken).toBe('new-access');
    expect(fresh.oauthRefreshToken).toBe('r-new');
    expect(typeof fresh.expiresAt).toBe('number');
    expect((fresh.expiresAt ?? 0) > Date.now()).toBe(true);
    // Must NOT mutate original.
    expect(baseOauth.oauthAccessToken).toBe('old-access');
  });

  it('falls back to the original refresh token when response omits one', async () => {
    const fakeFetch: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({ access_token: 'a-2', expires_in: 60 }),
      }) as unknown as Response;
    const fresh = await refreshOAuthProfile(baseOauth, { fetcher: fakeFetch });
    expect(fresh.oauthRefreshToken).toBe('r-old');
  });

  it('coalesces concurrent refreshes for the same rotating token', async () => {
    let release!: () => void;
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fakeFetch = vi.fn<typeof fetch>(async () => {
      await canFinish;
      return {
        ok: true,
        json: async () => ({ access_token: 'shared-access', refresh_token: 'shared-refresh', expires_in: 60 }),
      } as Response;
    });

    const first = refreshOAuthProfile(baseOauth, { fetcher: fakeFetch });
    const second = refreshOAuthProfile({ ...baseOauth }, { fetcher: fakeFetch });
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ oauthRefreshToken: 'shared-refresh' }),
      expect.objectContaining({ oauthRefreshToken: 'shared-refresh' }),
    ]);
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('throws on non-2xx responses with body excerpt in the message', async () => {
    const fakeFetch: typeof fetch = async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'invalid_grant',
      }) as unknown as Response;
    await expect(refreshOAuthProfile(baseOauth, { fetcher: fakeFetch })).rejects.toThrow(/401/);
  });

  it('throws when the response is missing access_token', async () => {
    const fakeFetch: typeof fetch = async () =>
      ({ ok: true, json: async () => ({ refresh_token: 'r-z' }) }) as unknown as Response;
    await expect(refreshOAuthProfile(baseOauth, { fetcher: fakeFetch })).rejects.toThrow(/access_token/);
  });

  it('rejects api-key profiles as a programming error', async () => {
    const apiKeyProfile: AuthProfile = {
      provider: 'openai',
      profileId: 'default',
      mode: 'api-key',
      apiKey: 'sk-1',
    };
    await expect(refreshOAuthProfile(apiKeyProfile)).rejects.toThrow(/oauth/);
  });

  it('rejects when refresh token is missing', async () => {
    const partial: AuthProfile = { ...baseOauth, oauthRefreshToken: undefined };
    await expect(refreshOAuthProfile(partial)).rejects.toThrow(/oauthRefreshToken/);
  });
});
