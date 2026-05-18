import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../auth/sync-provider-auth.js', () => ({
  resolveProviderApiKeySync: vi.fn((provider: string) =>
    provider === 'deepseek' ? 'sk-from-profiles' : undefined,
  ),
}));

vi.mock('../../../providers/index.js', () => ({
  getApiKeySync: vi.fn((provider: string) =>
    provider === 'openai' ? 'sk-from-env-registry' : undefined,
  ),
}));

import { AuthStorage, InMemoryAuthStorageBackend } from '@earendil-works/pi-coding-agent';

import { applyXopcProviderApiKey, resolveXopcProviderApiKey } from '../xopc-auth-storage.js';
import { resolveProviderApiKeySync } from '../../../auth/sync-provider-auth.js';
import { getApiKeySync } from '../../../providers/index.js';

describe('resolveXopcProviderApiKey', () => {
  it('prefers auth-profiles sync resolution', () => {
    expect(resolveXopcProviderApiKey('deepseek')).toBe('sk-from-profiles');
    expect(resolveProviderApiKeySync).toHaveBeenCalledWith('deepseek');
    expect(getApiKeySync).not.toHaveBeenCalledWith('deepseek');
  });

  it('falls back to registry / env sync path', () => {
    expect(resolveXopcProviderApiKey('openai')).toBe('sk-from-env-registry');
    expect(getApiKeySync).toHaveBeenCalledWith('openai');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveXopcProviderApiKey('unknown-vendor')).toBeUndefined();
  });
});

describe('applyXopcProviderApiKey', () => {
  function makeAuthStub() {
    const calls: Array<[string, string]> = [];
    return {
      setRuntimeApiKey: (provider: string, key: string) => {
        calls.push([provider, key]);
      },
      calls,
    };
  }

  it('injects the resolved key as a runtime override', () => {
    const auth = makeAuthStub();
    applyXopcProviderApiKey(auth as never, 'deepseek');
    expect(auth.calls).toEqual([['deepseek', 'sk-from-profiles']]);
  });

  it('skips extension-managed sentinel keys', () => {
    vi.mocked(getApiKeySync).mockReturnValueOnce('extension-managed');
    const auth = makeAuthStub();
    applyXopcProviderApiKey(auth as never, 'some-extension');
    expect(auth.calls).toEqual([]);
  });

  it('is a no-op when no key is available', () => {
    const auth = makeAuthStub();
    applyXopcProviderApiKey(auth as never, 'unknown-vendor');
    expect(auth.calls).toEqual([]);
  });
});

/**
 * End-to-end check that mirrors what pi-coding-agent's `ModelRegistry.getApiKeyAndHeaders`
 * does at runtime: read with `includeFallback: false`. Regression guard for the original
 * bug — `setFallbackResolver` alone did not surface keys here.
 */
describe('AuthStorage integration with applyXopcProviderApiKey', () => {
  function freshAuthStorage(): AuthStorage {
    return AuthStorage.fromStorage(new InMemoryAuthStorageBackend());
  }

  it('runtime override survives includeFallback:false (the request-time path)', async () => {
    const auth = freshAuthStorage();
    applyXopcProviderApiKey(auth, 'deepseek');
    await expect(
      auth.getApiKey('deepseek', { includeFallback: false }),
    ).resolves.toBe('sk-from-profiles');
  });

  it('models.json / env registry keys also flow through includeFallback:false', async () => {
    const auth = freshAuthStorage();
    applyXopcProviderApiKey(auth, 'openai');
    await expect(
      auth.getApiKey('openai', { includeFallback: false }),
    ).resolves.toBe('sk-from-env-registry');
  });

  it('extension-managed sentinel never lands as a runtime override', async () => {
    vi.mocked(getApiKeySync).mockReturnValueOnce('extension-managed');
    const auth = freshAuthStorage();
    applyXopcProviderApiKey(auth, 'some-extension');
    await expect(
      auth.getApiKey('some-extension', { includeFallback: false }),
    ).resolves.toBeUndefined();
  });

  it('unknown providers fall through to undefined', async () => {
    const auth = freshAuthStorage();
    applyXopcProviderApiKey(auth, 'unknown-vendor');
    await expect(
      auth.getApiKey('unknown-vendor', { includeFallback: false }),
    ).resolves.toBeUndefined();
  });
});
