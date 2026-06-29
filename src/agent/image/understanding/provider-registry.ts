import type { ImageUnderstandingProvider } from './types.js';

const registry = new Map<string, ImageUnderstandingProvider>();
const providerFactories = new Set<
  (providerId: string) => ImageUnderstandingProvider | undefined
>();

export function registerImageUnderstandingProvider(provider: ImageUnderstandingProvider): void {
  if (!provider.id?.trim()) {
    throw new Error('Image understanding provider id is required');
  }
  registry.set(provider.id.toLowerCase(), provider);
}

export function registerImageUnderstandingProviderFactory(
  factory: (providerId: string) => ImageUnderstandingProvider | undefined,
): void {
  providerFactories.add(factory);
}

export function getImageUnderstandingProvider(
  providerId: string,
): ImageUnderstandingProvider | undefined {
  const normalized = providerId.trim().toLowerCase();
  if (!normalized) return undefined;

  const registered = registry.get(normalized);
  if (registered) return registered;

  for (const factory of providerFactories) {
    const provider = factory(normalized);
    if (!provider) continue;
    registerImageUnderstandingProvider(provider);
    return registry.get(normalized);
  }

  return undefined;
}

export function listImageUnderstandingProviders(): ImageUnderstandingProvider[] {
  return [...registry.values()];
}

export function clearImageUnderstandingRegistryForTests(): void {
  registry.clear();
  providerFactories.clear();
}
