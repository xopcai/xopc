import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { isProviderApiKeyConfigured } from '../is-configured.js';
import { resolveApiKeyForProvider } from '../resolve-api-key.js';
import type { AuthProfileStore } from '../types.js';

function cfgWith(providers: Record<string, unknown>): Config {
  return { providers } as unknown as Config;
}

describe('resolveApiKeyForProvider', () => {
  it('returns undefined when nothing is configured', () => {
    const v = resolveApiKeyForProvider({
      providerId: 'whatever',
      envReader: () => undefined,
    });
    expect(v).toBeUndefined();
  });

  it('does not read credentials from config', () => {
    const cfg = cfgWith({ openai: { apiKey: 'sk-test' } });
    const v = resolveApiKeyForProvider({
      providerId: 'openai',
      cfg,
      envReader: () => undefined,
    });
    expect(v).toBeUndefined();
  });

  it('reads environment credentials', () => {
    const v = resolveApiKeyForProvider({
      providerId: 'dashscope',
      envReader: (name) => (name === 'DASHSCOPE_API_KEY' ? 'env-key' : undefined),
    });
    expect(v).toBe('env-key');
  });

  it('store has highest priority', () => {
    const store: AuthProfileStore = {
      getApiKeySync: () => 'from-store',
      hasCredentialSync: () => true,
      list: () => [
        { provider: 'openai', profileId: 'default', mode: 'api-key', apiKey: 'from-store' },
      ],
      get: () => ({ provider: 'openai', profileId: 'default', mode: 'api-key', apiKey: 'from-store' }),
    };
    const v = resolveApiKeyForProvider({
      providerId: 'openai',
      store,
      envReader: () => 'from-env',
    });
    expect(v).toBe('from-store');
  });

  it('safely ignores a throwing store and falls through to env', () => {
    const store: AuthProfileStore = {
      getApiKeySync: () => {
        throw new Error('store boom');
      },
      hasCredentialSync: () => false,
      list: () => [],
      get: () => {
        throw new Error('store boom');
      },
    };
    const v = resolveApiKeyForProvider({
      providerId: 'openai',
      store,
      envReader: () => 'from-env',
    });
    expect(v).toBe('from-env');
  });

  it('ignores legacy config apiKey values', () => {
    const cfg = cfgWith({ openai: { apiKey: '' }, minimax: { apiKey: 42 } });
    expect(
      resolveApiKeyForProvider({ providerId: 'openai', cfg, envReader: () => undefined }),
    ).toBeUndefined();
    expect(
      resolveApiKeyForProvider({ providerId: 'minimax', cfg, envReader: () => undefined }),
    ).toBeUndefined();
  });
});

describe('isProviderApiKeyConfigured', () => {
  it('returns true when a key resolves', () => {
    expect(
      isProviderApiKeyConfigured({
        providerId: 'openai',
        envReader: () => 'sk-1',
      }),
    ).toBe(true);
  });

  it('returns false when nothing resolves', () => {
    expect(
      isProviderApiKeyConfigured({
        providerId: 'unknown',
        envReader: () => undefined,
      }),
    ).toBe(false);
  });
});
