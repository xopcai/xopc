import type { VoiceCapability, VoiceProviderMetadata } from './types.js';

const registry = new Map<string, VoiceProviderMetadata>();

function normalizeKey(capability: VoiceCapability, providerId: string): string {
  return `${capability}:${providerId.trim().toLowerCase()}`;
}

export function registerVoiceProviderMetadata(metadata: VoiceProviderMetadata): () => void {
  const keys = [normalizeKey(metadata.capability, metadata.id)];
  for (const alias of metadata.aliases ?? []) {
    keys.push(normalizeKey(metadata.capability, alias));
  }
  for (const key of keys) {
    registry.set(key, metadata);
  }
  return () => {
    for (const key of keys) {
      if (registry.get(key) === metadata) {
        registry.delete(key);
      }
    }
  };
}

export function getVoiceProviderMetadata(
  capability: VoiceCapability,
  providerId: string,
): VoiceProviderMetadata | undefined {
  return registry.get(normalizeKey(capability, providerId));
}

export function listVoiceProviderMetadata(capability?: VoiceCapability): VoiceProviderMetadata[] {
  const seen = new Set<VoiceProviderMetadata>();
  const result: VoiceProviderMetadata[] = [];
  for (const metadata of registry.values()) {
    if (seen.has(metadata)) continue;
    if (capability && metadata.capability !== capability) continue;
    seen.add(metadata);
    result.push(metadata);
  }
  return result;
}

export function _clearVoiceProviderMetadataRegistryForTests(): void {
  registry.clear();
}
