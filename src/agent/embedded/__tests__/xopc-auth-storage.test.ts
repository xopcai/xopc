import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

import {
  applyXopcProviderApiKey,
  createEmbeddedModelRuntime,
  resolveXopcProviderApiKey,
} from '../xopc-auth-storage.js';
import { resolveProviderApiKeySync } from '../../../auth/sync-provider-auth.js';
import { resolveModelsJsonPath } from '../../../config/paths.js';
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
    const calls: Array<[string, string, { allowNetwork?: boolean } | undefined]> = [];
    return {
      setRuntimeApiKey: async (
        provider: string,
        key: string,
        refreshOptions?: { allowNetwork?: boolean },
      ) => {
        calls.push([provider, key, refreshOptions]);
      },
      calls,
    };
  }

  it('injects the resolved key as a runtime override', async () => {
    const auth = makeAuthStub();
    await applyXopcProviderApiKey(auth as never, 'deepseek');
    expect(auth.calls).toEqual([
      ['deepseek', 'sk-from-profiles', { allowNetwork: false }],
    ]);
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

describe('createEmbeddedModelRuntime', () => {
  it('loads custom providers from the xopc models.json path', async () => {
    const createSpy = vi.spyOn(ModelRuntime, 'create').mockResolvedValue({} as ModelRuntime);

    try {
      await createEmbeddedModelRuntime();

      expect(createSpy).toHaveBeenCalledWith({
        credentials: expect.any(InMemoryCredentialStore),
        modelsPath: resolveModelsJsonPath(),
      });
    } finally {
      createSpy.mockRestore();
    }
  });

  it('registers custom providers and resolves their configured auth', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-embedded-runtime-'));
    const previousStateDir = process.env.XOPC_STATE_DIR;
    const previousOffline = process.env.PI_OFFLINE;

    try {
      process.env.XOPC_STATE_DIR = stateDir;
      process.env.PI_OFFLINE = '1';
      await writeFile(
        join(stateDir, 'models.json'),
        JSON.stringify({
          providers: {
            'custom-test': {
              baseUrl: 'https://example.invalid/v1',
              api: 'openai-completions',
              apiKey: 'sk-test',
              models: [{ id: 'test-model', name: 'Test model' }],
            },
          },
        }),
      );

      const modelRuntime = await createEmbeddedModelRuntime();

      expect(modelRuntime.getModel('custom-test', 'test-model')).toBeDefined();
      await expect(modelRuntime.getAuth('custom-test')).resolves.toMatchObject({
        auth: { apiKey: 'sk-test' },
      });
    } finally {
      if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
      else process.env.XOPC_STATE_DIR = previousStateDir;
      if (previousOffline === undefined) delete process.env.PI_OFFLINE;
      else process.env.PI_OFFLINE = previousOffline;
      await rm(stateDir, { recursive: true, force: true });
    }
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
