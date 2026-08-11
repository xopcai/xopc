import { InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { CredentialResolver } from '../../auth/credentials.js';
import { XopcModelCredentialStore } from '../../auth/model-credential-store.js';
import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { resolveModelsJsonPath } from '../../config/paths.js';
import { getApiKeySync } from '../../providers/index.js';
import { registerRuntimeProviders } from '../../providers/register-runtime-providers.js';

export function resolveEmbeddedProviderApiKeySync(providerId: string): string | undefined {
  return resolveProviderApiKeySync(providerId) ?? getApiKeySync(providerId);
}

export async function createEmbeddedModelRuntime(providerId: string): Promise<ModelRuntime> {
  const resolver = new CredentialResolver();
  const credentials = new XopcModelCredentialStore(resolver);

  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: resolveModelsJsonPath(),
    modelsStore: new InMemoryModelsStore(),
  });

  registerRuntimeProviders(modelRuntime);

  const runtimeProvider = modelRuntime.getProvider(providerId);
  const storedCredential = await credentials.read(providerId);
  if (!(runtimeProvider?.auth.oauth && storedCredential?.type === 'oauth')) {
    const key = await resolver.resolveApiKey(providerId) ?? getApiKeySync(providerId);
    if (key && key !== 'extension-managed') {
      await modelRuntime.setRuntimeApiKey(providerId, key);
    }
  }

  return modelRuntime;
}
