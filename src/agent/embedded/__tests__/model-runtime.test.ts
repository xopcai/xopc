import { describe, expect, it, vi } from 'vitest';

import { InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

const resolveApiKey = vi.fn(async (provider: string) =>
  provider === 'xopc-cloud'
    ? 'oauth-access-token'
    : provider === 'openai'
      ? 'openai-api-key'
      : null,
);
const loadOAuthToken = vi.fn(async (provider: string) =>
  provider === 'openai-codex' || provider === 'xopc-cloud' || provider === 'anthropic'
    ? {
        type: 'oauth' as const,
        provider,
        access: provider === 'openai-codex'
          ? 'codex-oauth-access-token'
          : provider === 'anthropic'
            ? 'anthropic-oauth-access-token'
            : 'oauth-access-token',
        refresh: `${provider}-oauth-refresh-token`,
        expiresAt: Date.now() + 60 * 60_000,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }
    : null,
);
const loadOAuthTokenRecord = vi.fn(loadOAuthToken);
const { registerBunOAuthFlows } = vi.hoisted(() => ({
  registerBunOAuthFlows: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai/bun-oauth', () => ({
  registerBunOAuthFlows,
}));

vi.mock('../../../auth/credentials.js', () => ({
  CredentialResolver: class {
    resolveApiKey = resolveApiKey;
    loadOAuthToken = loadOAuthToken;
    loadOAuthTokenRecord = loadOAuthTokenRecord;
    listOAuthTokens = vi.fn(async () => []);
    saveOAuthToken = vi.fn(async () => undefined);
    deleteOAuthToken = vi.fn(async () => undefined);
  },
}));

vi.mock('../../../auth/sync-provider-auth.js', () => ({
  resolveProviderApiKeySync: vi.fn(() => undefined),
}));

vi.mock('../../../providers/index.js', () => ({
  getApiKeySync: vi.fn(() => undefined),
}));

import { createEmbeddedModelRuntime } from '../model-runtime.js';
import { XopcModelCredentialStore } from '../../../auth/model-credential-store.js';
import { resolveModelsJsonPath } from '../../../config/paths.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

describe('embedded model runtime', () => {
  it('registers statically bundled OAuth flows before creating the runtime', async () => {
    await createEmbeddedModelRuntime('openai');

    expect(registerBunOAuthFlows).toHaveBeenCalledTimes(1);
  });

  it('uses xopc credentials with an in-memory model catalog', async () => {
    const createSpy = vi.spyOn(ModelRuntime, 'create').mockResolvedValue({
      registerProvider: vi.fn(),
      getProvider: vi.fn(() => undefined),
      setRuntimeApiKey: vi.fn(),
    } as unknown as ModelRuntime);
    try {
      await createEmbeddedModelRuntime('openai');
      expect(createSpy).toHaveBeenCalledWith({
        credentials: expect.any(XopcModelCredentialStore),
        modelsPath: resolveModelsJsonPath(),
        modelsStore: expect.any(InMemoryModelsStore),
      });
    } finally {
      createSpy.mockRestore();
    }
  });

  it('registers xopc-cloud as OAuth-only and resolves its persisted credential', async () => {
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
      const runtime = await createEmbeddedModelRuntime('xopc-cloud');

      expect(runtime.getModel('xopc-cloud', 'deepseek-v4-flash')).toBeDefined();
      expect(runtime.getProvider('xopc-cloud')?.auth.apiKey).toBeUndefined();
      expect(runtime.getProvider('xopc-cloud')?.auth.oauth).toBeDefined();
      await expect(runtime.getAuth('xopc-cloud')).resolves.toMatchObject({
        auth: { apiKey: 'oauth-access-token' },
        source: 'OAuth',
      });
    } finally {
      resetModelCatalogStore();
    }
  });

  it('loads regular API-key provider credentials as runtime API keys', async () => {
    const runtime = await createEmbeddedModelRuntime('openai');

    await expect(runtime.getAuth('openai')).resolves.toMatchObject({
      auth: { apiKey: 'openai-api-key' },
    });
  });

  it('loads OAuth-only provider tokens as OAuth credentials', async () => {
    const runtime = await createEmbeddedModelRuntime('openai-codex');

    expect(runtime.hasConfiguredAuth('openai-codex')).toBe(true);
    await expect(runtime.getAuth('openai-codex')).resolves.toMatchObject({
      auth: { apiKey: 'codex-oauth-access-token' },
      source: 'OAuth',
    });
  });

  it('prefers OAuth credentials when the runtime provider supports both auth modes', async () => {
    const runtime = await createEmbeddedModelRuntime('anthropic');

    expect(runtime.getProvider('anthropic')?.auth.apiKey).toBeDefined();
    expect(runtime.getProvider('anthropic')?.auth.oauth).toBeDefined();
    await expect(runtime.getAuth('anthropic')).resolves.toMatchObject({
      auth: { apiKey: 'anthropic-oauth-access-token' },
      source: 'OAuth',
    });
  });
});
