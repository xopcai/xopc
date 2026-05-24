import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SharePolicyState = {
  enabled: boolean;
  defaultTtlHours: number;
  maxTtlDays: number;
  maxActiveShares: number;
  maxFileSizeMb: number;
  inlinePreviewMimes: string[];
};

export const DEFAULT_SHARE_POLICY: SharePolicyState = {
  enabled: true,
  defaultTtlHours: 24,
  maxTtlDays: 7,
  maxActiveShares: 100,
  maxFileSizeMb: 100,
  inlinePreviewMimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'],
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const BYTES_PER_MB = 1_048_576;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeStringList(raw: unknown, max = 32): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

export function normalizeSharePolicyFromConfig(config: unknown): SharePolicyState {
  const c = isRecord(config) ? config : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const share = isRecord(gw.share) ? gw.share : {};

  const defaultTtlMs =
    typeof share.defaultTtlMs === 'number' && Number.isFinite(share.defaultTtlMs)
      ? Math.floor(share.defaultTtlMs)
      : DEFAULT_SHARE_POLICY.defaultTtlHours * MS_PER_HOUR;
  const maxTtlMs =
    typeof share.maxTtlMs === 'number' && Number.isFinite(share.maxTtlMs)
      ? Math.floor(share.maxTtlMs)
      : DEFAULT_SHARE_POLICY.maxTtlDays * MS_PER_DAY;
  const maxFileSize =
    typeof share.maxFileSize === 'number' && Number.isFinite(share.maxFileSize)
      ? Math.floor(share.maxFileSize)
      : DEFAULT_SHARE_POLICY.maxFileSizeMb * BYTES_PER_MB;

  return {
    enabled: share.enabled !== false,
    defaultTtlHours: Math.max(1, Math.round(defaultTtlMs / MS_PER_HOUR)),
    maxTtlDays: Math.max(1, Math.round(maxTtlMs / MS_PER_DAY)),
    maxActiveShares:
      typeof share.maxActiveShares === 'number' && Number.isFinite(share.maxActiveShares)
        ? Math.max(1, Math.min(10_000, Math.floor(share.maxActiveShares)))
        : DEFAULT_SHARE_POLICY.maxActiveShares,
    maxFileSizeMb: Math.max(1, Math.round(maxFileSize / BYTES_PER_MB)),
    inlinePreviewMimes: normalizeStringList(share.inlinePreviewMimes, 32).length
      ? normalizeStringList(share.inlinePreviewMimes, 32)
      : [...DEFAULT_SHARE_POLICY.inlinePreviewMimes],
  };
}

export function validateSharePolicy(state: SharePolicyState): string | null {
  const defaultTtlMs = state.defaultTtlHours * MS_PER_HOUR;
  const maxTtlMs = state.maxTtlDays * MS_PER_DAY;

  if (defaultTtlMs < 60_000 || defaultTtlMs > 604_800_000) {
    return 'Default share TTL must be between 1 minute and 7 days.';
  }
  if (maxTtlMs < 60_000 || maxTtlMs > 2_592_000_000) {
    return 'Maximum share TTL must be between 1 minute and 30 days.';
  }
  if (defaultTtlMs > maxTtlMs) {
    return 'Default TTL cannot exceed maximum TTL.';
  }
  if (state.maxFileSizeMb < 1 || state.maxFileSizeMb > 10_240) {
    return 'Maximum file size must be between 1 MB and 10 GB.';
  }
  return null;
}

export async function patchSharePolicy(state: SharePolicyState): Promise<void> {
  const validationError = validateSharePolicy(state);
  if (validationError) {
    throw new Error(validationError);
  }

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        share: {
          enabled: state.enabled,
          defaultTtlMs: state.defaultTtlHours * MS_PER_HOUR,
          maxTtlMs: state.maxTtlDays * MS_PER_DAY,
          maxActiveShares: state.maxActiveShares,
          maxFileSize: state.maxFileSizeMb * BYTES_PER_MB,
          inlinePreviewMimes: state.inlinePreviewMimes,
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
