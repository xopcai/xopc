import { getAllModels, getModelsByProvider, getAllProviders, getProviderDisplayName, providerSupportsOAuth, isProviderConfigured, isProviderConfiguredSync } from '../providers/index.js';
import { getRecommendedModelsForProvider } from '../providers/presentation.js';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';
import { getImageGenerationProvider } from '../agent/image/generation/provider-registry.js';
import { listGlobalDefaults } from './global-defaults-admin.js';
import { getProviderSetupProfile, isInteractiveOnlyProvider } from '../providers/setup/profiles.js';
import type { SetupSnapshot } from '../providers/setup/engine.js';
import type { Config } from '../config/schema.js';
import { readSetupVoiceState } from '../providers/setup/voice.js';

export async function loadProviderSetupSnapshot(provider: string, config?: Config): Promise<SetupSnapshot> {
  if (!getAllProviders().includes(provider)) throw new Error(`Unknown model provider: ${provider}`);
  return readProviderSetupSnapshot(provider, await isProviderConfigured(provider), config);
}

export function readProviderSetupSnapshot(provider: string, configured: boolean, config?: Config): SetupSnapshot {
  const models = getModelsByProvider(provider).filter(model => !('computerUse' in model && model.computerUse));
  const recommended = new Set(getRecommendedModelsForProvider(provider).map(model => model.ref));
  const source = getModelCatalogStore().getSource(provider);
  const image = getImageGenerationProvider(provider);
  const images = image?.models.filter(id => provider !== 'xopc-cloud' || source?.models.some(model => model.id === id && model.availability === 'available')) ?? [];
  const configuredProviders = new Set(getAllProviders().filter(isProviderConfiguredSync));
  const backgroundRestrictedModels = new Set(getAllModels().filter(model => isInteractiveOnlyProvider(model.provider, model.baseUrl)).map(model => `${model.provider}/${model.id}`));
  for (const model of models) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(model.baseUrl)) configuredProviders.add(provider);
  }
  return {
    ...(config ? { voice: readSetupVoiceState(provider, config) } : {}),
    configured: configured || configuredProviders.has(provider), configuredProviders, backgroundRestrictedModels, defaults: listGlobalDefaults().defaults,
    profile: getProviderSetupProfile(provider, getProviderDisplayName(provider), providerSupportsOAuth(provider), models[0]?.baseUrl),
    models: models.map(model => ({ ref: `${provider}/${model.id}`, name: model.name, vision: model.input.includes('image'), reasoning: model.reasoning, baseUrl: model.baseUrl, api: model.api, recommended: recommended.has(`${provider}/${model.id}`) })),
    images: images.map(id => ({ ref: `${provider}/${id}`, name: id })),
  };
}
