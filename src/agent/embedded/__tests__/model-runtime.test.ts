import { describe, expect, it, vi } from 'vitest';

import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

const resolveApiKey = vi.fn(async (provider: string) =>
  provider === 'xopc-cloud' ? 'oauth-access-token' : null,
);

vi.mock('../../../auth/credentials.js', () => ({
  CredentialResolver: class {
    resolveApiKey = resolveApiKey;
  },
}));

vi.mock('../../../auth/sync-provider-auth.js', () => ({
  resolveProviderApiKeySync: vi.fn(() => undefined),
}));

vi.mock('../../../providers/index.js', () => ({
  getApiKeySync: vi.fn(() => undefined),
}));

import {
  applyEmbeddedProviderCredential,
  createEmbeddedModelRuntime,
} from '../model-runtime.js';
import { resolveModelsJsonPath } from '../../../config/paths.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

describe('embedded model runtime', () => {
  it('uses only in-memory runtime stores', async () => {
    const createSpy = vi.spyOn(ModelRuntime, 'create').mockResolvedValue({
      registerProvider: vi.fn(),
    } as unknown as ModelRuntime);
    try {
      await createEmbeddedModelRuntime();
      expect(createSpy).toHaveBeenCalledWith({
        credentials: expect.any(InMemoryCredentialStore),
        modelsPath: resolveModelsJsonPath(),
        modelsStore: expect.any(InMemoryModelsStore),
      });
    } finally {
      createSpy.mockRestore();
    }
  });

  it('registers catalog models and injects the OAuth access token', async () => {
    resetModelCatalogStore();
    getModelCatalogStore().replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: 'https://router.xopc.ai/v1',
      api: 'openai-completions',
      etag: 'catalog-1',
      recommendedModel: 'deepseek-v4-flash',
      lastSuccessAt: Date.now(),
    }, [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', maxOutputTokens: 8192 }]);

    try {
      const runtime = await createEmbeddedModelRuntime();
      await applyEmbeddedProviderCredential(runtime, 'xopc-cloud');

      expect(runtime.getModel('xopc-cloud', 'deepseek-v4-flash')).toBeDefined();
      await expect(runtime.getAuth('xopc-cloud')).resolves.toMatchObject({
        auth: { apiKey: 'oauth-access-token' },
      });
    } finally {
      resetModelCatalogStore();
    }
  });
});
