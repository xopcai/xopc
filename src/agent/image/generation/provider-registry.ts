import { buildDashScopeImageGenerationProvider } from './providers/dashscope.js';
import { buildFalImageGenerationProvider } from './providers/fal.js';
import { buildGoogleImageGenerationProvider } from './providers/google.js';
import { buildMinimaxImageGenerationProvider } from './providers/minimax.js';
import { buildOpenAIImageGenerationProvider } from './providers/openai.js';
import type { ImageGenerationProvider, ImageGenerationProviderSummary } from './types.js';

const providers: ImageGenerationProvider[] = [
  buildOpenAIImageGenerationProvider(),
  buildDashScopeImageGenerationProvider(),
  buildMinimaxImageGenerationProvider(),
  buildGoogleImageGenerationProvider(),
  buildFalImageGenerationProvider(),
];

const providersById = new Map(providers.map((provider) => [provider.id, provider]));

export function getImageGenerationProvider(providerId: string): ImageGenerationProvider | undefined {
  return providersById.get(providerId);
}

export function listImageGenerationProviders(): ImageGenerationProvider[] {
  return [...providers];
}

export function listImageGenerationProvidersSummary(): ImageGenerationProviderSummary[] {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    defaultModel: provider.defaultModel,
    models: [...provider.models],
    capabilities: provider.capabilities,
  }));
}

export type { ImageGenerationProvider, ImageGenerationProviderSummary } from './types.js';
