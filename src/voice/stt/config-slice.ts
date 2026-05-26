/**
 * STT config slice resolution — maps persisted config to per-provider raw config.
 *
 * Supports OpenClaw-aligned `tools.media.audio.providers.<id>` plus legacy flat keys
 * (`tools.media.audio.openai`, `tools.media.audio.alibaba`, …).
 */

import type { STTConfig } from './types.js';

/** Top-level `tools.media.audio` keys that are not provider config buckets. */
export const STT_CONFIG_RESERVED_KEYS = new Set([
  'enabled',
  'provider',
  'providers',
  'models',
  'fallback',
  'timeoutMs',
  'sharedModels',
]);

/** Built-in env fallbacks when config slice has no apiKey. */
export const STT_LEGACY_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  alibaba: 'DASHSCOPE_API_KEY',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asProviderConfig(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

/** Collect provider-id → raw config entries from providers map + legacy flat keys. */
export function collectSttProviderConfigEntries(
  config: Partial<STTConfig> | Record<string, unknown> | undefined,
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
    if (STT_CONFIG_RESERVED_KEYS.has(key)) {
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
export function resolveSttProviderConfigSlice(
  providerId: string,
  config: Partial<STTConfig> | Record<string, unknown> | undefined,
): Record<string, unknown> {
  const entries = collectSttProviderConfigEntries(config);
  return entries[providerId] ?? {};
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const text = trimToUndefined(entry);
    if (text) {
      out[key] = text;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Read normalized provider fields from a config slice or model entry override. */
export function readSttProviderFields(
  slice: Record<string, unknown>,
  entryOverride?: Record<string, unknown>,
): {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  language?: string;
  prompt?: string;
} {
  const merged = { ...slice, ...(entryOverride ?? {}) };
  return {
    apiKey: trimToUndefined(merged.apiKey),
    model: trimToUndefined(merged.model),
    baseUrl: trimToUndefined(merged.baseUrl),
    headers: readStringRecord(merged.headers),
    language: trimToUndefined(merged.language),
    prompt: trimToUndefined(merged.prompt),
  };
}
