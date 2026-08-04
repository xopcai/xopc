import { loadModelsJson } from '../../../config/models-json.js';
import type { ModelsJsonConfig } from '../../../config/models-json.js';
import { createLogger } from '../../../utils/logger.js';

import { buildCustomOpenAiImagesProvider } from './custom-openai-images-provider.js';
import { buildDashScopeImageGenerationProvider } from './providers/dashscope.js';
import { buildFalImageGenerationProvider } from './providers/fal.js';
import { buildGoogleImageGenerationProvider } from './providers/google.js';
import { buildMinimaxImageGenerationProvider } from './providers/minimax.js';
import { buildOpenAIImageGenerationProvider } from './providers/openai.js';
import type { ImageGenerationProvider, ImageGenerationProviderSummary } from './types.js';

const log = createLogger('ImageGenerationRegistry');

const builtInProviders: ImageGenerationProvider[] = [
  buildOpenAIImageGenerationProvider(),
  buildDashScopeImageGenerationProvider(),
  buildMinimaxImageGenerationProvider(),
  buildGoogleImageGenerationProvider(),
  buildFalImageGenerationProvider(),
];

let providers: ImageGenerationProvider[] = [...builtInProviders];
let providersById = new Map(providers.map((provider) => [provider.id, provider]));
let customProvidersLoaded = false;

function ensureCustomProvidersLoaded(): void {
  if (!customProvidersLoaded) reloadImageGenerationProviders();
}

export function reloadImageGenerationProviders(config?: ModelsJsonConfig): void {
  let resolved = config;
  if (!resolved) {
    const loaded = loadModelsJson();
    if (loaded.error) {
      log.warn({ errorMessage: loaded.error }, `Custom image providers not loaded: ${loaded.error}`);
      providers = [...builtInProviders];
      providersById = new Map(providers.map((provider) => [provider.id, provider]));
      customProvidersLoaded = true;
      return;
    }
    resolved = loaded.config;
  }

  const builtInIds = new Set(builtInProviders.map((provider) => provider.id));
  const customEntries = Object.entries(resolved.providers)
    .filter((entry): entry is [string, typeof entry[1] & { imageGeneration: NonNullable<typeof entry[1]['imageGeneration']> }] =>
      Boolean(entry[1].imageGeneration));
  const conflictingId = customEntries.find(([providerId]) => builtInIds.has(providerId))?.[0];
  if (conflictingId) {
    throw new Error(`Custom image generation cannot override built-in provider "${conflictingId}".`);
  }
  const customProviders = customEntries
    .map(([providerId, provider]) =>
      buildCustomOpenAiImagesProvider({
        providerId,
        provider,
        imageGeneration: provider.imageGeneration,
      }));

  providers = [...builtInProviders, ...customProviders];
  providersById = new Map(providers.map((provider) => [provider.id, provider]));
  customProvidersLoaded = true;
}

export function getImageGenerationProvider(providerId: string): ImageGenerationProvider | undefined {
  ensureCustomProvidersLoaded();
  return providersById.get(providerId);
}

export function listImageGenerationProviders(): ImageGenerationProvider[] {
  ensureCustomProvidersLoaded();
  return [...providers];
}

export function listImageGenerationProvidersSummary(): ImageGenerationProviderSummary[] {
  ensureCustomProvidersLoaded();
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    source: provider.source ?? 'builtin',
    credentialMode: provider.credentialMode ?? 'api-key',
    ...(provider.documentationUrl ? { documentationUrl: provider.documentationUrl } : {}),
    ...(provider.apiKeyUrl ? { apiKeyUrl: provider.apiKeyUrl } : {}),
    defaultModel: provider.defaultModel,
    models: [...provider.models],
    capabilities: provider.capabilities,
    ...(provider.modelCapabilities
      ? { modelCapabilities: structuredClone(provider.modelCapabilities) }
      : {}),
  }));
}

export type { ImageGenerationProvider, ImageGenerationProviderSummary } from './types.js';
