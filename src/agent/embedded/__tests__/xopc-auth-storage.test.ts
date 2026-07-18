import { describe, expect, it, vi } from 'vitest';

import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

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
      setRuntimeApiKey: async (provider: string, key: string) => {
        calls.push([provider, key]);
      },
      calls,
    };
  }

  it('injects the resolved key as a runtime override', async () => {
    const auth = makeAuthStub();
    await applyXopcProviderApiKey(auth as never, 'deepseek');
    expect(auth.calls).toEqual([['deepseek', 'sk-from-profiles']]);
  });

  it('skips extension-managed sentinel keys', async () => {
    vi.mocked(getApiKeySync).mockReturnValueOnce('extension-managed');
    const auth = makeAuthStub();
    await applyXopcProviderApiKey(auth as never, 'some-extension');
    expect(auth.calls).toEqual([]);
  });

  it('is a no-op when no key is available', async () => {
    const auth = makeAuthStub();
    await applyXopcProviderApiKey(auth as never, 'unknown-vendor');
    expect(auth.calls).toEqual([]);
  });
});

describe('ModelRuntime integration with applyXopcProviderApiKey', () => {
  async function freshModelRuntime(): Promise<ModelRuntime> {
    return ModelRuntime.create({
      allowModelNetwork: false,
      credentials: new InMemoryCredentialStore(),
    });
  }

  it('injects the profile API key into request auth', async () => {
    const modelRuntime = await freshModelRuntime();
    await applyXopcProviderApiKey(modelRuntime, 'deepseek');

    await expect(modelRuntime.getAuth('deepseek')).resolves.toMatchObject({
      auth: { apiKey: 'sk-from-profiles' },
    });
  });

  it('injects registry and environment API keys into request auth', async () => {
    const modelRuntime = await freshModelRuntime();
    await applyXopcProviderApiKey(modelRuntime, 'openai');

    await expect(modelRuntime.getAuth('openai')).resolves.toMatchObject({
      auth: { apiKey: 'sk-from-env-registry' },
    });
  });

  it('does not write extension-managed sentinel keys', async () => {
    vi.mocked(getApiKeySync).mockReturnValueOnce('extension-managed');
    const modelRuntime = await freshModelRuntime();
    await applyXopcProviderApiKey(modelRuntime, 'some-extension');

    await expect(modelRuntime.getAuth('some-extension')).resolves.toBeUndefined();
  });

  it('leaves unconfigured providers without request auth', async () => {
    const modelRuntime = await freshModelRuntime();
    await applyXopcProviderApiKey(modelRuntime, 'unknown-vendor');

    await expect(modelRuntime.getAuth('unknown-vendor')).resolves.toBeUndefined();
  });
});
