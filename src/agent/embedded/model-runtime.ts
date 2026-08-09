import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { CredentialResolver } from '../../auth/credentials.js';
import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { resolveModelsJsonPath } from '../../config/paths.js';
import { getApiKeySync } from '../../providers/index.js';
import { getModelCatalogStore } from '../../providers/model-catalog-store.js';

export function resolveEmbeddedProviderApiKeySync(providerId: string): string | undefined {
  return resolveProviderApiKeySync(providerId) ?? getApiKeySync(providerId);
}

export async function createEmbeddedModelRuntime(): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: resolveModelsJsonPath(),
    modelsStore: new InMemoryModelsStore(),
  });

  for (const source of Object.values(getModelCatalogStore().load().sources)) {
    modelRuntime.registerProvider(source.providerId, {
      name: source.providerId,
      baseUrl: source.baseUrl,
      api: source.api,
      models: source.models.filter((model) => model.availability === 'available').map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: model.maxOutputTokens ?? 16_384,
      })),
    });
  }

  return modelRuntime;
}

export async function applyEmbeddedProviderCredential(
  modelRuntime: Pick<ModelRuntime, 'setRuntimeApiKey'>,
  providerId: string,
): Promise<void> {
  const key = await new CredentialResolver().resolveApiKey(providerId)
    ?? getApiKeySync(providerId);
  if (key && key !== 'extension-managed') {
    await modelRuntime.setRuntimeApiKey(providerId, key);
  }
}
