import { z } from 'zod';

import type { Config } from '../config/schema.js';
import { SHARE_CONFIG_DEFAULTS, type ShareConfig } from './share-types.js';

const ShareConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultTtlMs: z.number().int().min(60_000).max(604_800_000).optional(),
  maxTtlMs: z.number().int().min(60_000).max(2_592_000_000).optional(),
  maxActiveShares: z.number().int().min(1).max(10_000).optional(),
  maxFileSize: z.number().int().min(1_048_576).max(10_737_418_240).optional(),
  inlinePreviewMimes: z.array(z.string().min(1)).optional(),
});

export function resolveShareConfig(raw: unknown): ShareConfig {
  const patch = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<ShareConfig>) : {};
  return {
    enabled: patch.enabled ?? SHARE_CONFIG_DEFAULTS.enabled,
    defaultTtlMs: patch.defaultTtlMs ?? SHARE_CONFIG_DEFAULTS.defaultTtlMs,
    maxTtlMs: patch.maxTtlMs ?? SHARE_CONFIG_DEFAULTS.maxTtlMs,
    maxActiveShares: patch.maxActiveShares ?? SHARE_CONFIG_DEFAULTS.maxActiveShares,
    maxFileSize: patch.maxFileSize ?? SHARE_CONFIG_DEFAULTS.maxFileSize,
    inlinePreviewMimes: Array.isArray(patch.inlinePreviewMimes)
      ? patch.inlinePreviewMimes.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [...SHARE_CONFIG_DEFAULTS.inlinePreviewMimes],
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
      host: '127.0.0.1',
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
    ...(parsed.data.inlinePreviewMimes
      ? {
          inlinePreviewMimes: parsed.data.inlinePreviewMimes
            .map((x) => x.trim())
            .filter(Boolean),
        }
      : {}),
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
