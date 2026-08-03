import type { Config } from '../../../config/schema.js';
/**
 * Per-vendor slice of {@link Config.providers} safe for GET `/api/config`.
 */
export type SafeProviderAuthEntry = {
  region?: string;
  baseUrl?: string;
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
    const entry: SafeProviderAuthEntry = {};
    if (typeof o.region === 'string' && o.region.trim()) {
      entry.region = o.region.trim();
    }
    if (typeof o.baseUrl === 'string' && o.baseUrl.trim()) {
      entry.baseUrl = o.baseUrl.trim();
    }
    out[id] = entry;
  }
  return out;
}
