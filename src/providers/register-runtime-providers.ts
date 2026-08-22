import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { getOAuthProviderDefinition } from '../auth/oauth/registry.js';
import {
  getModelCatalogStore,
  type CatalogSource,
  type ModelCatalogSnapshot,
} from './model-catalog-store.js';
import {
  resolveXopcModelRouterUrl,
  XOPC_CLOUD_PROVIDER_ID,
} from './xopc-cloud-config.js';

type RuntimeProviderRegistrar = Pick<ModelRuntime, 'registerProvider'>;

function registerRuntimeProvider(
  modelRuntime: RuntimeProviderRegistrar,
  source: CatalogSource,
): void {
  const oauthDefinition = getOAuthProviderDefinition(source.providerId);
  const oauth = oauthDefinition?.oauthOnly
    ? {
        name: oauthDefinition.displayName,
        login: oauthDefinition.provider.login.bind(oauthDefinition.provider),
        refreshToken: oauthDefinition.provider.refreshToken.bind(oauthDefinition.provider),
        getApiKey: oauthDefinition.provider.getApiKey.bind(oauthDefinition.provider),
      }
    : undefined;

  modelRuntime.registerProvider(source.providerId, {
    name: oauthDefinition?.displayName ?? source.providerId,
    baseUrl: source.baseUrl,
    api: source.api,
    oauth,
    models: source.models.filter((model) =>
      model.availability === 'available' && model.kind === 'language').map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxOutputTokens ?? 16_384,
    })),
  });
}

/** Register dynamically discovered model providers, including their OAuth contract. */
export function registerRuntimeProviders(
  modelRuntime: RuntimeProviderRegistrar,
  catalog: ModelCatalogSnapshot = getModelCatalogStore().load(),
): void {
  for (const source of Object.values(catalog.sources)) {
    registerRuntimeProvider(modelRuntime, source);
  }

  if (!catalog.sources[XOPC_CLOUD_PROVIDER_ID]) {
    registerRuntimeProvider(modelRuntime, {
      providerId: XOPC_CLOUD_PROVIDER_ID,
      baseUrl: resolveXopcModelRouterUrl(),
      api: 'openai-completions',
      etag: null,
      recommendedModel: null,
      lastSuccessAt: 0,
      models: [],
    });
  }
}
