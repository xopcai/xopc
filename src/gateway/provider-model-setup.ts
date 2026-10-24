import { getAllModels, getModelsByProvider, getAllProviders, getProviderDisplayName, providerSupportsOAuth, isProviderConfigured, isProviderConfiguredSync } from '../providers/index.js';
import { getRecommendedModelsForProvider } from '../providers/presentation.js';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';
import { getImageGenerationProvider } from '../agent/image/generation/provider-registry.js';
import { listGlobalDefaults } from './global-defaults-admin.js';
import { getProviderSetupProfile, isInteractiveOnlyProvider } from '../providers/setup/profiles.js';
import type { SetupSnapshot } from '../providers/setup/engine.js';
import type { Config } from '../config/schema.js';
import { listSttProvidersForApi } from '../voice/stt/list-providers.js';
import { listTtsProvidersForApi } from '../voice/tts/list-providers.js';
import { readSetupVoiceState } from '../providers/setup/voice.js';

export async function loadProviderSetupSnapshot(provider: string, config?: Config): Promise<SetupSnapshot> {
  const languageProvider = getAllProviders().includes(provider);
  const mediaProvider = getImageGenerationProvider(provider)
    || listSttProvidersForApi(config).providers.some(entry => entry.id === provider)
    || listTtsProvidersForApi(config).providers.some(entry => entry.id === provider);
  if (!languageProvider && !mediaProvider) throw new Error(`Unknown model provider: ${provider}`);
  return readProviderSetupSnapshot(provider, languageProvider && await isProviderConfigured(provider), config);
}

export function readProviderSetupSnapshot(provider: string, configured: boolean, config?: Config): SetupSnapshot {
  const languageProvider = getAllProviders().includes(provider);
  const models = (languageProvider ? getModelsByProvider(provider) : []).filter(model => !('computerUse' in model && model.computerUse) && !('phoneUse' in model && model.phoneUse));
  const recommended = new Set((languageProvider ? getRecommendedModelsForProvider(provider) : []).map(model => model.ref));
  const source = getModelCatalogStore().getSource(provider);
  const image = getImageGenerationProvider(provider);
  const images = image?.models.filter(id => provider !== 'xopc-cloud' || source?.models.some(model => model.id === id && model.availability === 'available')) ?? [];
  const configuredProviders = new Set(getAllProviders().filter(isProviderConfiguredSync));
  const backgroundRestrictedModels = new Set(getAllModels().filter(model => isInteractiveOnlyProvider(model.provider, model.baseUrl)).map(model => `${model.provider}/${model.id}`));
  for (const model of models) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(model.baseUrl)) configuredProviders.add(provider);
  }
  const voice = config ? readSetupVoiceState(provider, config) : undefined;
  const imageConfigured = image?.isConfigured({ cfg: config }) ?? false;
  const nativeVoiceConfigured = Boolean(!['qwen-token-plan-cn', 'xopc-cloud'].includes(provider) && voice && Object.values(voice.choices).some(choices => choices.length));
  return {
    ...(config ? { voice: voice! } : {}),
    configured: configured || configuredProviders.has(provider) || imageConfigured || nativeVoiceConfigured, configuredProviders, backgroundRestrictedModels, defaults: listGlobalDefaults().defaults,
    profile: getProviderSetupProfile(provider, getProviderDisplayName(provider), providerSupportsOAuth(provider), models[0]?.baseUrl),
    models: (!configured && !configuredProviders.has(provider) && (nativeVoiceConfigured || imageConfigured) ? [] : models).map(model => ({ ref: `${provider}/${model.id}`, name: model.name, vision: model.input.includes('image'), reasoning: model.reasoning, baseUrl: model.baseUrl, api: model.api, recommended: recommended.has(`${provider}/${model.id}`) })),
    images: (nativeVoiceConfigured && !imageConfigured && !configured ? [] : images).map(id => ({ ref: `${provider}/${id}`, name: id })),
  };
}
