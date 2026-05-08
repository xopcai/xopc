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

  it('reads cfg.providers.<id>.apiKey when present', () => {
    const cfg = cfgWith({ openai: { apiKey: 'sk-test' } });
    const v = resolveApiKeyForProvider({
      providerId: 'openai',
      cfg,
      envReader: () => undefined,
    });
    expect(v).toBe('sk-test');
  });

  it('falls through to env when cfg has no apiKey', () => {
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
    };
    const cfg = cfgWith({ openai: { apiKey: 'sk-cfg' } });
    const v = resolveApiKeyForProvider({
      providerId: 'openai',
      cfg,
      store,
      envReader: () => 'from-env',
    });
    expect(v).toBe('from-store');
  });

  it('safely ignores store throwing', () => {
    const store: AuthProfileStore = {
      getApiKeySync: () => {
        throw new Error('store boom');
      },
      hasCredentialSync: () => false,
    };
    const cfg = cfgWith({ openai: { apiKey: 'sk-cfg' } });
    const v = resolveApiKeyForProvider({
      providerId: 'openai',
      cfg,
      store,
      envReader: () => undefined,
    });
    expect(v).toBe('sk-cfg');
  });

  it('treats empty / non-string apiKey as missing', () => {
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
        cfg: cfgWith({ openai: { apiKey: 'sk-1' } }),
        envReader: () => undefined,
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
