/**
 * SpeechProviderRegistry — central lookup for SpeechProviderPlugin instances.
 *
 * Per docs/voice-rearchitecture.md §11:
 *   - Bundled providers (openai/alibaba/edge/minimax/local-cli) self-register at
 *     module load time via `registerSpeechProvider()`.
 *   - Extension-loaded providers register through `extensions/sdk/speech.ts`
 *     re-exports of the same registration call.
 *   - Lookup is case-insensitive on `id` and `aliases`.
 *   - Re-registering the same id LOGS a warning and OVERWRITES (later registration
 *     wins — used by user extensions to override bundled defaults).
 *
 * DECISION: We do NOT separate "loaded vs configured" the way openclaw does
 * (their `listLoadedSpeechProviders` vs `listSpeechProviders`). xopc's extension
 * model is much simpler — extensions either load successfully or they don't.
 * If a provider is in the registry, it's loaded; whether it's configured is a
 * runtime question answered by `provider.isConfigured(ctx)`.
 */

import { createLogger } from '../../utils/logger.js';

import type { SpeechProviderId, SpeechProviderPlugin } from './speech-provider-types.js';

const log = createLogger('SpeechRegistry');

const registry = new Map<string, SpeechProviderPlugin>();

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function indexProvider(provider: SpeechProviderPlugin): string[] {
  const keys = [normalizeId(provider.id)];
  for (const alias of provider.aliases ?? []) {
    keys.push(normalizeId(alias));
  }
  return keys;
}

/**
 * Register a speech provider. Safe to call multiple times during boot — later
 * registrations overwrite earlier ones for the same id (with a warn log).
 *
 * Returns an unregister function for tests / hot-reload scenarios.
 */
export function registerSpeechProvider(provider: SpeechProviderPlugin): () => void {
  const keys = indexProvider(provider);
  const conflicts: string[] = [];
  for (const key of keys) {
    if (registry.has(key)) {
      conflicts.push(key);
    }
  }
  if (conflicts.length > 0) {
    log.warn(
      { providerId: provider.id, conflicts },
      `Speech provider "${provider.id}" overrides existing registration(s): ${conflicts.join(', ')}`,
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

/**
 * Look up a provider by id or alias (case-insensitive). Returns undefined when
 * no provider matches — callers must NOT throw here; the orchestrator decides
 * whether the absence is fatal or means "skip and try next provider".
 */
export function getSpeechProvider(id: SpeechProviderId): SpeechProviderPlugin | undefined {
  return registry.get(normalizeId(id));
}

/**
 * Resolve the canonical id for a provider lookup key (id or alias).
 * Useful for normalizing config strings before persistence.
 */
export function canonicalizeSpeechProviderId(id: SpeechProviderId): SpeechProviderId | undefined {
  return registry.get(normalizeId(id))?.id;
}

/**
 * List all registered providers. Order is registration order (Map preserves
 * insertion order, and we de-dup by id at registration time).
 */
export function listSpeechProviders(): SpeechProviderPlugin[] {
  const seen = new Set<SpeechProviderPlugin>();
  const result: SpeechProviderPlugin[] = [];
  for (const provider of registry.values()) {
    if (!seen.has(provider)) {
      seen.add(provider);
      result.push(provider);
    }
  }
  return result;
}

/** Test-only: clear the registry. Not exported from the public barrel. */
export function _clearSpeechRegistryForTests(): void {
  registry.clear();
}
