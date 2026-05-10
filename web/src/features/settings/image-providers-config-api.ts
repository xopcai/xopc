import { isMaskedKey } from '@/features/settings/providers-api';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** One row of image-provider credential fields (matches PATCH `providersConfig` subset). */
export type ImageProviderCredRow = {
  apiKey: string;
  region: string;
  baseUrl: string;
  imageBaseUrl: string;
};

export function emptyImageProviderCredRow(): ImageProviderCredRow {
  return { apiKey: '', region: '', baseUrl: '', imageBaseUrl: '' };
}

export type SafeProviderAuthEntry = {
  apiKey: string;
  region?: string;
  baseUrl?: string;
  imageBaseUrl?: string;
};

function maskedApiKeyDisplay(safe?: SafeProviderAuthEntry): string {
  if (!safe?.apiKey) return '';
  return '••••••••••••';
}

/** Read `payload.config.providersConfig` from GET /api/config (masked). */
export function imageProviderCredRowsFromConfigRoot(
  config: unknown,
  imageProviderIds: string[],
): Record<string, ImageProviderCredRow> {
  const pc = (() => {
    if (!config || typeof config !== 'object' || !('providersConfig' in config)) return undefined;
    const v = (config as { providersConfig?: unknown }).providersConfig;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    return v as Record<string, SafeProviderAuthEntry>;
  })();

  const out: Record<string, ImageProviderCredRow> = {};
  for (const id of imageProviderIds) {
    const safe = pc?.[id];
    out[id] = {
      apiKey: maskedApiKeyDisplay(safe),
      region: safe?.region ?? '',
      baseUrl: safe?.baseUrl ?? '',
      imageBaseUrl: safe?.imageBaseUrl ?? '',
    };
  }
  return out;
}

function optionalStringField(
  draft: ImageProviderCredRow,
  baseline: ImageProviderCredRow,
  key: keyof Pick<ImageProviderCredRow, 'region' | 'baseUrl' | 'imageBaseUrl'>,
): string | null | undefined {
  const d = draft[key].trim();
  const b = baseline[key].trim();
  if (d === b) return undefined;
  if (!d) return null;
  return d;
}

function apiKeyPatchValue(draftKey: string, baselineKey: string): string | null | undefined {
  const d = draftKey.trim();
  const b = baselineKey.trim();
  if (d === b) return undefined;
  if (isMaskedKey(d) && isMaskedKey(b)) return undefined;
  if (!d) {
    if (!b) return undefined;
    return null;
  }
  return d;
}

/**
 * Build `providersConfig` PATCH entries only for image providers whose row changed.
 * Omits `apiKey` when unchanged (still masked); sends `null` to clear stored key.
 */
export function buildImageProvidersConfigPatch(
  imageProviderIds: string[],
  draft: Record<string, ImageProviderCredRow>,
  baseline: Record<string, ImageProviderCredRow>,
): Record<string, Record<string, unknown>> {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const id of imageProviderIds) {
    const d = draft[id] ?? emptyImageProviderCredRow();
    const b = baseline[id] ?? emptyImageProviderCredRow();
    if (JSON.stringify(d) === JSON.stringify(b)) continue;

    const entry: Record<string, unknown> = {};
    const keyDelta = apiKeyPatchValue(d.apiKey, b.apiKey);
    if (keyDelta !== undefined) {
      entry.apiKey = keyDelta;
    }
    const region = optionalStringField(d, b, 'region');
    if (region !== undefined) entry.region = region;
    const baseUrl = optionalStringField(d, b, 'baseUrl');
    if (baseUrl !== undefined) entry.baseUrl = baseUrl;
    const imageBaseUrl = optionalStringField(d, b, 'imageBaseUrl');
    if (imageBaseUrl !== undefined) entry.imageBaseUrl = imageBaseUrl;

    if (Object.keys(entry).length > 0) {
      patch[id] = entry;
    }
  }
  return patch;
}

export type RevealImageProviderApiKeyPayload = {
  id: string;
  apiKey: string | null;
  source: 'config' | 'none';
};

/** POST /api/image/providers/:id/reveal-api-key — plaintext only when stored in config file. */
export async function revealImageProviderConfigApiKey(providerId: string): Promise<RevealImageProviderApiKeyPayload> {
  const data = await fetchJson<{
    ok?: boolean;
    payload?: RevealImageProviderApiKeyPayload;
    error?: { message?: string };
  }>(apiUrl(`/api/image/providers/${encodeURIComponent(providerId)}/reveal-api-key`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!data.ok || !data.payload) {
    throw new Error(data.error?.message ?? 'Reveal failed');
  }
  return data.payload;
}

export async function patchImageProvidersConfig(
  patch: Record<string, Record<string, unknown>>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ providersConfig: patch }),
  });
  await revalidateGatewayConfig();
}
