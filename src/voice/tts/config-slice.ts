/**
 * TTS config slice resolution — maps persisted config to per-provider raw config.
 *
 * Reads `messages.tts.providers.<id>` only — there is no legacy flat-key form.
 */

import type { TTSConfig } from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Collect provider-id → raw config entries from the `providers` map. */
export function collectTtsProviderConfigEntries(
  config: Partial<TTSConfig> | Record<string, unknown> | undefined,
): Record<string, Record<string, unknown>> {
  const raw = (config ?? {}) as Record<string, unknown>;
  const providers = asRecord(raw.providers);
  if (!providers) return {};
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [providerId, value] of Object.entries(providers)) {
    entries[providerId] = { ...(asRecord(value) ?? {}) };
  }
  return entries;
}

/** Resolve the raw config slice for one provider id. */
export function resolveTtsProviderConfigSlice(
  providerId: string,
  config: Partial<TTSConfig> | Record<string, unknown> | undefined,
): Record<string, unknown> {
  return collectTtsProviderConfigEntries(config)[providerId] ?? {};
}

/**
 * Build the `rawConfig` object passed into `SpeechProviderPlugin.resolveConfig`.
 * Includes the full TTS block plus a normalized `providers` map.
 */
export function buildTtsResolveRawConfig(
  providerId: string,
  config: Partial<TTSConfig> | Record<string, unknown>,
): Record<string, unknown> {
  const entries = collectTtsProviderConfigEntries(config);
  return {
    ...(config as Record<string, unknown>),
    providers: entries,
    [providerId]: entries[providerId] ?? {},
  };
}
