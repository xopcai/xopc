import type {
  ImageGenerationCapabilities,
  ImageGenerationRequest,
  ImageGenerationResult,
} from './types.js';

export interface ImageGenerationProvider {
  id: string;
  label?: string;
  defaultModel?: string;
  models?: string[];
  capabilities?: ImageGenerationCapabilities;
  isConfigured?: () => Promise<boolean>;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

const registry = new Map<string, ImageGenerationProvider>();

export function registerImageGenerationProvider(provider: ImageGenerationProvider): void {
  if (!provider.id?.trim()) {
    throw new Error('Image generation provider id is required');
  }
  registry.set(provider.id.toLowerCase(), provider);
}

export function getImageGenerationProvider(providerId: string): ImageGenerationProvider | undefined {
  return registry.get(providerId.toLowerCase());
}

export function listImageGenerationProviders(): ImageGenerationProvider[] {
  return [...registry.values()];
}

export function listImageGenerationProvidersSummary(): Array<{
  id: string;
  defaultModel?: string;
  models: string[];
}> {
  return [...registry.values()].map((provider) => ({
    id: provider.id,
    defaultModel: provider.defaultModel,
    models: provider.models ?? (provider.defaultModel ? [provider.defaultModel] : []),
  }));
}

export function clearImageGenerationRegistryForTests(): void {
  registry.clear();
}
