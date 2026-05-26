/**
 * TTS config slice resolution — maps persisted config to per-provider raw config.
 *
 * Supports OpenClaw-aligned `messages.tts.providers.<id>` plus legacy flat keys
 * (`messages.tts.openai`, `messages.tts.tts-local-cli`, …).
 */

import type { TTSConfig } from './types.js';

/** Top-level `messages.tts` keys that are not provider config buckets. */
export const TTS_CONFIG_RESERVED_KEYS = new Set([
  'auto',
  'enabled',
  'maxTextLength',
  'mode',
  'modelOverrides',
  'persona',
  'personas',
  'prefsPath',
  'provider',
  'providers',
  'summaryModel',
  'timeoutMs',
  'trigger',
  'fallback',
  'summarization',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asProviderConfig(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

/** Collect provider-id → raw config entries from providers map + legacy flat keys. */
export function collectTtsProviderConfigEntries(
  config: Partial<TTSConfig> | Record<string, unknown> | undefined,
): Record<string, Record<string, unknown>> {
  const raw = (config ?? {}) as Record<string, unknown>;
  const entries: Record<string, Record<string, unknown>> = {};

  const providers = asRecord(raw.providers);
  if (providers) {
    for (const [providerId, value] of Object.entries(providers)) {
      entries[providerId] = { ...entries[providerId], ...asProviderConfig(value) };
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (TTS_CONFIG_RESERVED_KEYS.has(key)) {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }
    if (entries[key] === undefined) {
      entries[key] = asProviderConfig(value);
    }
  }

  return entries;
}

/** Resolve the raw config slice for one provider id. */
export function resolveTtsProviderConfigSlice(
  providerId: string,
  config: Partial<TTSConfig> | Record<string, unknown> | undefined,
): Record<string, unknown> {
  const entries = collectTtsProviderConfigEntries(config);
  return entries[providerId] ?? {};
}

/**
 * Build the `rawConfig` object passed into `SpeechProviderPlugin.resolveConfig`.
 * Includes the full TTS block, normalized `providers` map, and a top-level slice
 * for the active provider (matches built-in `rawConfig[id] ?? rawConfig` reads).
 */
export function buildTtsResolveRawConfig(
  providerId: string,
  config: Partial<TTSConfig> | Record<string, unknown>,
): Record<string, unknown> {
  const entries = collectTtsProviderConfigEntries(config);
  const slice = entries[providerId] ?? {};
  return {
    ...(config as Record<string, unknown>),
    providers: entries,
    [providerId]: slice,
  };
}
