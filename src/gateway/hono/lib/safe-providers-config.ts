import type { Config } from '../../../config/schema.js';
import { maskSecretLength } from './mask-secret-length.js';

/**
 * Per-vendor slice of {@link Config.providers} safe for GET `/api/config`.
 * Secrets are never sent verbatim; `apiKey` is length-preserving bullets when set, else empty.
 */
export type SafeProviderAuthEntry = {
  apiKey: string;
  region?: string;
  baseUrl?: string;
  imageBaseUrl?: string;
};

/**
 * Build a redacted `providersConfig` map for the gateway console (image / audio / video keys).
 */
export function buildSafeProvidersConfigForWeb(
  providers: Config['providers'] | undefined,
): Record<string, SafeProviderAuthEntry> {
  if (!providers || typeof providers !== 'object') return {};
  const out: Record<string, SafeProviderAuthEntry> = {};
  for (const [id, raw] of Object.entries(providers)) {
    if (!id) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const apiKey =
      typeof o.apiKey === 'string' && o.apiKey.trim() ? maskSecretLength(o.apiKey) : '';
    const entry: SafeProviderAuthEntry = { apiKey };
    if (typeof o.region === 'string' && o.region.trim()) {
      entry.region = o.region.trim();
    }
    if (typeof o.baseUrl === 'string' && o.baseUrl.trim()) {
      entry.baseUrl = o.baseUrl.trim();
    }
    if (typeof o.imageBaseUrl === 'string' && o.imageBaseUrl.trim()) {
      entry.imageBaseUrl = o.imageBaseUrl.trim();
    }
    out[id] = entry;
  }
  return out;
}
