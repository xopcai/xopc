import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SharePolicyState = {
  enabled: boolean;
  defaultTtlHours: number;
  maxTtlDays: number;
  maxActiveShares: number;
  maxFileSizeMb: number;
  directoryMaxFolderSizeMb: number;
  directoryMaxFileCount: number;
  inlinePreviewMimes: string[];
  siteEnabled: boolean;
  siteDefaultTtlHours: number;
  siteMaxTtlDays: number;
  maxActiveSites: number;
  siteMaxRootDirSizeMb: number;
  siteMaxFileCount: number;
};

const DEFAULT_SHARE_POLICY: SharePolicyState = {
  enabled: true,
  defaultTtlHours: 24,
  maxTtlDays: 30,
  maxActiveShares: 500,
  maxFileSizeMb: 500,
  directoryMaxFolderSizeMb: 2_048,
  directoryMaxFileCount: 10_000,
  inlinePreviewMimes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'text/html',
    'text/markdown',
    'text/plain',
    'application/json',
  ],
  siteEnabled: true,
  siteDefaultTtlHours: 24,
  siteMaxTtlDays: 30,
  maxActiveSites: 50,
  siteMaxRootDirSizeMb: 1_024,
  siteMaxFileCount: 20_000,
};

export function getRecommendedSharePolicy(): SharePolicyState {
  return structuredClone(DEFAULT_SHARE_POLICY);
}

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
  const directory = isRecord(share.directory) ? share.directory : {};
  const siteShare = isRecord(gw.siteShare) ? gw.siteShare : {};
  const siteStatic = isRecord(siteShare.static) ? siteShare.static : {};

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
  const directoryMaxFolderSize =
    typeof directory.maxFolderSize === 'number' && Number.isFinite(directory.maxFolderSize)
      ? Math.floor(directory.maxFolderSize)
      : DEFAULT_SHARE_POLICY.directoryMaxFolderSizeMb * BYTES_PER_MB;
  const siteDefaultTtlMs =
    typeof siteShare.defaultTtlMs === 'number' && Number.isFinite(siteShare.defaultTtlMs)
      ? Math.floor(siteShare.defaultTtlMs)
      : DEFAULT_SHARE_POLICY.siteDefaultTtlHours * MS_PER_HOUR;
  const siteMaxTtlMs =
    typeof siteShare.maxTtlMs === 'number' && Number.isFinite(siteShare.maxTtlMs)
      ? Math.floor(siteShare.maxTtlMs)
      : DEFAULT_SHARE_POLICY.siteMaxTtlDays * MS_PER_DAY;
  const siteMaxRootDirSize =
    typeof siteStatic.maxRootDirSize === 'number' && Number.isFinite(siteStatic.maxRootDirSize)
      ? Math.floor(siteStatic.maxRootDirSize)
      : DEFAULT_SHARE_POLICY.siteMaxRootDirSizeMb * BYTES_PER_MB;

  return {
    enabled: share.enabled !== false,
    defaultTtlHours: Math.max(1, Math.round(defaultTtlMs / MS_PER_HOUR)),
    maxTtlDays: Math.max(1, Math.round(maxTtlMs / MS_PER_DAY)),
    maxActiveShares:
      typeof share.maxActiveShares === 'number' && Number.isFinite(share.maxActiveShares)
        ? Math.max(1, Math.min(10_000, Math.floor(share.maxActiveShares)))
        : DEFAULT_SHARE_POLICY.maxActiveShares,
    maxFileSizeMb: Math.max(1, Math.round(maxFileSize / BYTES_PER_MB)),
    directoryMaxFolderSizeMb: Math.max(1, Math.round(directoryMaxFolderSize / BYTES_PER_MB)),
    directoryMaxFileCount:
      typeof directory.maxFileCount === 'number' && Number.isFinite(directory.maxFileCount)
        ? Math.max(1, Math.min(100_000, Math.floor(directory.maxFileCount)))
        : DEFAULT_SHARE_POLICY.directoryMaxFileCount,
    inlinePreviewMimes: normalizeStringList(share.inlinePreviewMimes, 32).length
      ? normalizeStringList(share.inlinePreviewMimes, 32)
      : [...DEFAULT_SHARE_POLICY.inlinePreviewMimes],
    siteEnabled: siteShare.enabled !== false,
    siteDefaultTtlHours: Math.max(1, Math.round(siteDefaultTtlMs / MS_PER_HOUR)),
    siteMaxTtlDays: Math.max(1, Math.round(siteMaxTtlMs / MS_PER_DAY)),
    maxActiveSites:
      typeof siteShare.maxActiveSites === 'number' && Number.isFinite(siteShare.maxActiveSites)
        ? Math.max(1, Math.min(1_000, Math.floor(siteShare.maxActiveSites)))
        : DEFAULT_SHARE_POLICY.maxActiveSites,
    siteMaxRootDirSizeMb: Math.max(1, Math.round(siteMaxRootDirSize / BYTES_PER_MB)),
    siteMaxFileCount:
      typeof siteStatic.maxFileCount === 'number' && Number.isFinite(siteStatic.maxFileCount)
        ? Math.max(1, Math.min(100_000, Math.floor(siteStatic.maxFileCount)))
        : DEFAULT_SHARE_POLICY.siteMaxFileCount,
  };
}

export function validateSharePolicy(state: SharePolicyState): string | null {
  const defaultTtlMs = state.defaultTtlHours * MS_PER_HOUR;
  const maxTtlMs = state.maxTtlDays * MS_PER_DAY;
  const siteDefaultTtlMs = state.siteDefaultTtlHours * MS_PER_HOUR;
  const siteMaxTtlMs = state.siteMaxTtlDays * MS_PER_DAY;

  if (defaultTtlMs < 60_000 || defaultTtlMs > 604_800_000) {
    return 'Default share TTL must be between 1 minute and 7 days.';
  }
  if (maxTtlMs < 60_000 || maxTtlMs > 2_592_000_000) {
    return 'Maximum share TTL must be between 1 minute and 30 days.';
  }
  if (defaultTtlMs > maxTtlMs) {
    return 'Default TTL cannot exceed maximum TTL.';
  }
  if (state.maxActiveShares < 1 || state.maxActiveShares > 10_000) {
    return 'Maximum active shares must be between 1 and 10,000.';
  }
  if (state.maxActiveSites < 1 || state.maxActiveSites > 1_000) {
    return 'Maximum active site shares must be between 1 and 1,000.';
  }
  if (state.maxFileSizeMb < 1 || state.maxFileSizeMb > 10_240) {
    return 'Maximum file size must be between 1 MB and 10 GB.';
  }
  if (state.directoryMaxFolderSizeMb < 1 || state.directoryMaxFolderSizeMb > 10_240) {
    return 'Maximum folder size must be between 1 MB and 10 GB.';
  }
  if (state.directoryMaxFileCount < 1 || state.directoryMaxFileCount > 100_000) {
    return 'Maximum directory file count must be between 1 and 100,000.';
  }
  if (siteDefaultTtlMs < 60_000 || siteDefaultTtlMs > 604_800_000) {
    return 'Default site share TTL must be between 1 minute and 7 days.';
  }
  if (siteMaxTtlMs < 60_000 || siteMaxTtlMs > 2_592_000_000) {
    return 'Maximum site share TTL must be between 1 minute and 30 days.';
  }
  if (siteDefaultTtlMs > siteMaxTtlMs) {
    return 'Default site TTL cannot exceed maximum site TTL.';
  }
  if (state.siteMaxRootDirSizeMb < 1 || state.siteMaxRootDirSizeMb > 10_240) {
    return 'Maximum static site size must be between 1 MB and 10 GB.';
  }
  if (state.siteMaxFileCount < 1 || state.siteMaxFileCount > 100_000) {
    return 'Maximum static site file count must be between 1 and 100,000.';
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
          directory: {
            maxFolderSize: state.directoryMaxFolderSizeMb * BYTES_PER_MB,
            maxFileCount: state.directoryMaxFileCount,
          },
        },
        siteShare: {
          enabled: state.siteEnabled,
          defaultTtlMs: state.siteDefaultTtlHours * MS_PER_HOUR,
          maxTtlMs: state.siteMaxTtlDays * MS_PER_DAY,
          maxActiveSites: state.maxActiveSites,
          static: {
            maxRootDirSize: state.siteMaxRootDirSizeMb * BYTES_PER_MB,
            maxFileCount: state.siteMaxFileCount,
          },
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
