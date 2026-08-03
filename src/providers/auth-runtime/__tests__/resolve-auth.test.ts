import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { resolveAuthProfileForProvider } from '../resolve-auth.js';
import type { AuthProfile, AuthProfileStore } from '../types.js';

function cfgWith(providers: Record<string, unknown>): Config {
  return { providers } as unknown as Config;
}

function makeStore(profile?: AuthProfile): AuthProfileStore {
  return {
    getApiKeySync: () => profile?.apiKey ?? profile?.oauthAccessToken,
    hasCredentialSync: () => Boolean(profile?.apiKey || profile?.oauthAccessToken),
    list: () => (profile ? [profile] : []),
    get: () => profile,
  };
}

describe('resolveAuthProfileForProvider', () => {
  it('returns source: "none" when nothing configured', () => {
    const r = resolveAuthProfileForProvider({ providerId: 'whatever', envReader: () => undefined });
    expect(r).toMatchObject({ apiKey: undefined, mode: 'api-key', source: 'none' });
  });

  it('store wins over env, mode follows the profile', () => {
    const profile: AuthProfile = {
      provider: 'openai',
      profileId: 'codex',
      mode: 'oauth',
      oauthAccessToken: 'oauth-tok',
    };
    const r = resolveAuthProfileForProvider({
      providerId: 'openai',
      store: makeStore(profile),
      envReader: () => 'env-key',
    });
    expect(r).toMatchObject({
      apiKey: 'oauth-tok',
      mode: 'oauth',
      profileId: 'codex',
      source: 'store',
    });
  });

  it('environment key uses non-secret Azure connection metadata', () => {
    const cfg = cfgWith({
      openai: {
        azure: { resource: 'my-az', deployment: 'gpt-image-2' },
      },
    });
    const r = resolveAuthProfileForProvider({
      providerId: 'openai',
      cfg,
      envReader: () => 'sk-azure',
    });
    expect(r.source).toBe('env');
    expect(r.mode).toBe('azure-key');
    expect(r.apiKey).toBe('sk-azure');
    expect(r.meta).toEqual({ resource: 'my-az', deployment: 'gpt-image-2' });
  });

  it('falls back to env when nothing else matches', () => {
    const r = resolveAuthProfileForProvider({
      providerId: 'dashscope',
      envReader: (n) => (n === 'DASHSCOPE_API_KEY' ? 'env-dash' : undefined),
    });
    expect(r).toMatchObject({ apiKey: 'env-dash', mode: 'api-key', source: 'env' });
  });

  it('store throwing is swallowed; resolution falls through to env', () => {
    const bad: AuthProfileStore = {
      getApiKeySync: () => {
        throw new Error('boom');
      },
      hasCredentialSync: () => false,
      list: () => [],
      get: () => {
        throw new Error('boom-get');
      },
    };
    const r = resolveAuthProfileForProvider({
      providerId: 'openai',
      store: bad,
      envReader: () => 'env-key',
    });
    expect(r).toMatchObject({ apiKey: 'env-key', mode: 'api-key', source: 'env' });
  });
});
