import { z } from 'zod';

import type { Config } from '../config/schema.js';
import {
  SHARE_CONFIG_DEFAULTS,
  type ShareConfig,
  type ShareDirectoryConfig,
  type ShareThumbnailConfig,
  type ShareNoteConfig,
} from './share-types.js';

const ShareDirectoryPatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxFolderSize: z.number().int().min(1_048_576).max(10_737_418_240).optional(),
  maxFileCount: z.number().int().min(1).max(100_000).optional(),
  maxDepth: z.number().int().min(1).max(64).optional(),
  listingCacheMs: z.number().int().min(0).max(600_000).optional(),
  zipConcurrency: z.number().int().min(1).max(8).optional(),
});

const ShareThumbnailPatchSchema = z.object({
  enabled: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  maxBytes: z.number().int().min(8_192).max(4_194_304).optional(),
  viewportWidth: z.number().int().min(320).max(2_560).optional(),
  viewportHeight: z.number().int().min(320).max(2_560).optional(),
  generationTimeoutMs: z.number().int().min(1_000).max(60_000).optional(),
  failureCooldownMs: z.number().int().min(0).max(3_600_000).optional(),
  internalGatewayUrl: z.string().min(1).optional(),
});

const ShareNotePatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxMarkdownBytes: z.number().int().min(1_024).max(10_485_760).optional(),
  maxAttachmentCount: z.number().int().min(0).max(500).optional(),
  maxAttachmentSize: z.number().int().min(1_024).max(1_073_741_824).optional(),
  maxTotalSize: z.number().int().min(1_024).max(2_147_483_648).optional(),
  assetTicketTtlMs: z.number().int().min(60_000).max(3_600_000).optional(),
  revokeOnSourceDelete: z.boolean().optional(),
});

const ShareConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultTtlMs: z.number().int().min(60_000).max(604_800_000).optional(),
  maxTtlMs: z.number().int().min(60_000).max(2_592_000_000).optional(),
  maxActiveShares: z.number().int().min(1).max(10_000).optional(),
  maxFileSize: z.number().int().min(1_048_576).max(10_737_418_240).optional(),
  inlinePreviewMimes: z.array(z.string().min(1)).optional(),
  directory: ShareDirectoryPatchSchema.optional(),
  thumbnail: ShareThumbnailPatchSchema.optional(),
  note: ShareNotePatchSchema.optional(),
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

function resolveThumbnailConfig(raw: unknown): ShareThumbnailConfig {
  const base = SHARE_CONFIG_DEFAULTS.thumbnail;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  const patch = raw as Partial<ShareThumbnailConfig>;
  return {
    enabled: patch.enabled ?? base.enabled,
    concurrency: patch.concurrency ?? base.concurrency,
    maxBytes: patch.maxBytes ?? base.maxBytes,
    viewportWidth: patch.viewportWidth ?? base.viewportWidth,
    viewportHeight: patch.viewportHeight ?? base.viewportHeight,
    generationTimeoutMs: patch.generationTimeoutMs ?? base.generationTimeoutMs,
    failureCooldownMs: patch.failureCooldownMs ?? base.failureCooldownMs,
    internalGatewayUrl: patch.internalGatewayUrl ?? base.internalGatewayUrl,
  };
}

function resolveNoteConfig(raw: unknown): ShareNoteConfig {
  const base = SHARE_CONFIG_DEFAULTS.note;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  const patch = raw as Partial<ShareNoteConfig>;
  return {
    enabled: patch.enabled ?? base.enabled,
    maxMarkdownBytes: patch.maxMarkdownBytes ?? base.maxMarkdownBytes,
    maxAttachmentCount: patch.maxAttachmentCount ?? base.maxAttachmentCount,
    maxAttachmentSize: patch.maxAttachmentSize ?? base.maxAttachmentSize,
    maxTotalSize: patch.maxTotalSize ?? base.maxTotalSize,
    assetTicketTtlMs: patch.assetTicketTtlMs ?? base.assetTicketTtlMs,
    revokeOnSourceDelete: patch.revokeOnSourceDelete ?? base.revokeOnSourceDelete,
  };
}

export function resolveShareConfig(raw: unknown): ShareConfig {
  const patch =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<ShareConfig> & { directory?: unknown; thumbnail?: unknown; note?: unknown })
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
    thumbnail: resolveThumbnailConfig(patch.thumbnail),
    note: resolveNoteConfig(patch.note),
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
    thumbnail: parsed.data.thumbnail
      ? { ...current.thumbnail, ...parsed.data.thumbnail }
      : current.thumbnail,
    note: parsed.data.note
      ? { ...current.note, ...parsed.data.note }
      : current.note,
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
