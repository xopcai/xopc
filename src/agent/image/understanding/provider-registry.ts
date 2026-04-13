import type { ImageUnderstandingProvider } from './types.js';

const registry = new Map<string, ImageUnderstandingProvider>();

export function registerImageUnderstandingProvider(provider: ImageUnderstandingProvider): void {
  if (!provider.id?.trim()) {
    throw new Error('Image understanding provider id is required');
  }
  registry.set(provider.id.toLowerCase(), provider);
}

export function getImageUnderstandingProvider(
  providerId: string,
): ImageUnderstandingProvider | undefined {
  return registry.get(providerId.toLowerCase());
}

export function listImageUnderstandingProviders(): ImageUnderstandingProvider[] {
  return [...registry.values()];
}

export function clearImageUnderstandingRegistryForTests(): void {
  registry.clear();
}
