import { z } from 'zod';

import type { Config } from '../config/schema.js';
import {
  SHARE_CONFIG_DEFAULTS,
  type ShareConfig,
  type ShareDirectoryConfig,
} from './share-types.js';

const ShareDirectoryPatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxFolderSize: z.number().int().min(1_048_576).max(10_737_418_240).optional(),
  maxFileCount: z.number().int().min(1).max(100_000).optional(),
  maxDepth: z.number().int().min(1).max(64).optional(),
  listingCacheMs: z.number().int().min(0).max(600_000).optional(),
  zipConcurrency: z.number().int().min(1).max(8).optional(),
});

const ShareConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultTtlMs: z.number().int().min(60_000).max(604_800_000).optional(),
  maxTtlMs: z.number().int().min(60_000).max(2_592_000_000).optional(),
  maxActiveShares: z.number().int().min(1).max(10_000).optional(),
  maxFileSize: z.number().int().min(1_048_576).max(10_737_418_240).optional(),
  inlinePreviewMimes: z.array(z.string().min(1)).optional(),
  directory: ShareDirectoryPatchSchema.optional(),
});

function resolveDirectoryConfig(raw: unknown): ShareDirectoryConfig {
  const base = SHARE_CONFIG_DEFAULTS.directory;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  const patch = raw as Partial<ShareDirectoryConfig>;
  return {
    enabled: patch.enabled ?? base.enabled,
    maxFolderSize: patch.maxFolderSize ?? base.maxFolderSize,
    maxFileCount: patch.maxFileCount ?? base.maxFileCount,
    maxDepth: patch.maxDepth ?? base.maxDepth,
    listingCacheMs: patch.listingCacheMs ?? base.listingCacheMs,
    zipConcurrency: patch.zipConcurrency ?? base.zipConcurrency,
  };
}

export function resolveShareConfig(raw: unknown): ShareConfig {
  const patch =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<ShareConfig> & { directory?: unknown })
      : {};
  return {
    enabled: patch.enabled ?? SHARE_CONFIG_DEFAULTS.enabled,
    defaultTtlMs: patch.defaultTtlMs ?? SHARE_CONFIG_DEFAULTS.defaultTtlMs,
    maxTtlMs: patch.maxTtlMs ?? SHARE_CONFIG_DEFAULTS.maxTtlMs,
    maxActiveShares: patch.maxActiveShares ?? SHARE_CONFIG_DEFAULTS.maxActiveShares,
    maxFileSize: patch.maxFileSize ?? SHARE_CONFIG_DEFAULTS.maxFileSize,
    inlinePreviewMimes: Array.isArray(patch.inlinePreviewMimes)
      ? patch.inlinePreviewMimes.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [...SHARE_CONFIG_DEFAULTS.inlinePreviewMimes],
    directory: resolveDirectoryConfig(patch.directory),
  };
}

export function mergeShareConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = ShareConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  if (!config.gateway) {
    config.gateway = {
      bind: 'loopback',
      port: 18790,
      auth: { mode: 'token' },
      heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
      maxSseConnections: 100,
      corsOrigins: [],
    };
  }

  const current = resolveShareConfig(config.gateway.share);
  const next: ShareConfig = {
    ...current,
    ...parsed.data,
    inlinePreviewMimes: parsed.data.inlinePreviewMimes
      ? parsed.data.inlinePreviewMimes.map((x) => x.trim()).filter(Boolean)
      : current.inlinePreviewMimes,
    directory: parsed.data.directory
      ? { ...current.directory, ...parsed.data.directory }
      : current.directory,
  };

  if (next.defaultTtlMs > next.maxTtlMs) {
    return {
      ok: false,
      message: 'gateway.share.defaultTtlMs must not exceed gateway.share.maxTtlMs',
    };
  }

  config.gateway.share = next;
  return { ok: true };
}
