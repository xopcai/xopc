/**
 * MediaUnderstandingProviderRegistry — central lookup for STT/image/video
 * provider plugins.
 *
 * Mirrors the SpeechProviderRegistry pattern at src/voice/tts/speech-registry.ts
 * intentionally — same registration semantics, same alias handling, same
 * conflict-warn-and-overwrite policy.
 *
 * DECISION: The two registries are kept separate (rather than a single
 * "media provider" registry) because:
 *   1. SpeechProviderPlugin and MediaUnderstandingProvider have different
 *      method shapes (synthesize vs transcribeAudio + describeImage).
 *   2. Many vendors implement only one side (Edge TTS has no STT; Whisper has
 *      no TTS), so a unified registry would require a sparse capability matrix
 *      anyway.
 *   3. Discovery UIs naturally split by direction (TTS list vs STT list).
 *
 * When a vendor implements BOTH (e.g. OpenAI), the registration code creates
 * two separate plugin objects sharing config — this stays explicit and avoids
 * "is this method on this object?" guessing in callers.
 */

import { createLogger } from '../utils/logger.js';

import type { MediaCapability, MediaUnderstandingProvider } from './types.js';

const log = createLogger('MediaUnderstandingRegistry');

const registry = new Map<string, MediaUnderstandingProvider>();

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function indexProvider(provider: MediaUnderstandingProvider): string[] {
  const keys = [normalizeId(provider.id)];
  for (const alias of provider.aliases ?? []) {
    keys.push(normalizeId(alias));
  }
  return keys;
}

export function registerMediaUnderstandingProvider(
  provider: MediaUnderstandingProvider,
): () => void {
  const keys = indexProvider(provider);
  const conflicts = keys.filter((key) => registry.has(key));
  if (conflicts.length > 0) {
    log.warn(
      { providerId: provider.id, conflicts },
      `Media-understanding provider "${provider.id}" overrides existing registration(s): ${conflicts.join(', ')}`,
    );
  }
  for (const key of keys) {
    registry.set(key, provider);
  }
  return () => {
    for (const key of keys) {
      const current = registry.get(key);
      if (current === provider) {
        registry.delete(key);
      }
    }
  };
}

export function getMediaUnderstandingProvider(id: string): MediaUnderstandingProvider | undefined {
  return registry.get(normalizeId(id));
}

export function listMediaUnderstandingProviders(): MediaUnderstandingProvider[] {
  const seen = new Set<MediaUnderstandingProvider>();
  const result: MediaUnderstandingProvider[] = [];
  for (const provider of registry.values()) {
    if (!seen.has(provider)) {
      seen.add(provider);
      result.push(provider);
    }
  }
  return result;
}

/**
 * List providers that DECLARE the requested capability via `capabilities[]`
 * AND have an actual method implementation. The runner uses this to build
 * the per-capability fallback chain.
 */
export function listProvidersForCapability(
  capability: MediaCapability,
): MediaUnderstandingProvider[] {
  const methodKey =
    capability === 'audio'
      ? 'transcribeAudio'
      : capability === 'image'
        ? 'describeImage'
        : 'describeVideo';
  return listMediaUnderstandingProviders().filter((provider) => {
    const declared = provider.capabilities?.includes(capability) ?? false;
    const implemented =
      typeof (provider as unknown as Record<string, unknown>)[methodKey] === 'function';
    return declared && implemented;
  });
}

/** Test-only: clear the registry. Not exported from the package barrel. */
export function _clearMediaUnderstandingRegistryForTests(): void {
  registry.clear();
}
