/**
 * STT config slice resolution — maps persisted config to per-provider raw config.
 *
 * Reads `tools.media.audio.providers.<id>` only — there is no legacy flat-key form.
 */

import type { STTConfig } from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Collect provider-id → raw config entries from the `providers` map. */
export function collectSttProviderConfigEntries(
  config: Partial<STTConfig> | Record<string, unknown> | undefined,
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
export function resolveSttProviderConfigSlice(
  providerId: string,
  config: Partial<STTConfig> | Record<string, unknown> | undefined,
): Record<string, unknown> {
  return collectSttProviderConfigEntries(config)[providerId] ?? {};
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
