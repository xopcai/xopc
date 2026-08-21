import { z } from 'zod';

import type { Config } from './schema.js';
import {
  SessionConfigSchema,
  SessionDmScopeSchema,
  UpdateAutoConfigSchema,
  UpdateConfigSchema,
} from './schema.js';

const SessionStoragePatchSchema = z.object({
  pruneAfterMs: z.union([z.number().int().min(0), z.null()]).optional(),
  maxEntries: z.union([z.number().int().min(1), z.null()]).optional(),
});

const SessionConfigPatchSchema = z.object({
  dmScope: SessionDmScopeSchema.optional(),
  storage: SessionStoragePatchSchema.optional(),
});

const UpdateAutoPatchSchema = z.object({
  enabled: z.boolean().optional(),
  stableDelayHours: z.number().min(0).optional(),
  stableJitterHours: z.number().min(0).optional(),
  betaCheckIntervalHours: z.number().min(0.25).optional(),
});

const UpdateConfigPatchSchema = z.object({
  checkOnStart: z.boolean().optional(),
  channel: z.enum(['stable', 'beta', 'dev']).optional(),
  auto: UpdateAutoPatchSchema.optional(),
});

const GatewaySkillsPatchSchema = z.object({
  skillsMarketplaceProvider: z.string().min(1).optional(),
  skillsStoreBaseUrl: z.string().url().optional(),
});

export function mergeSessionConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = SessionConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const current = config.session ?? SessionConfigSchema.parse({});
  const next = { ...current, ...parsed.data };
  if (parsed.data.storage !== undefined) {
    const storagePatch = parsed.data.storage;
    const nextStorage = { ...(current.storage ?? {}) };
    if ('pruneAfterMs' in storagePatch) {
      if (storagePatch.pruneAfterMs === null) delete nextStorage.pruneAfterMs;
      else if (storagePatch.pruneAfterMs !== undefined) nextStorage.pruneAfterMs = storagePatch.pruneAfterMs;
    }
    if ('maxEntries' in storagePatch) {
      if (storagePatch.maxEntries === null) delete nextStorage.maxEntries;
      else if (storagePatch.maxEntries !== undefined) nextStorage.maxEntries = storagePatch.maxEntries;
    }
    if (Object.keys(nextStorage).length === 0) delete next.storage;
    else next.storage = nextStorage;
  }
  config.session = next;
  return { ok: true };
}

export function mergeUpdateConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = UpdateConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const current = config.update ?? { checkOnStart: true, channel: 'stable' as const };
  const merged = {
    ...current,
    ...parsed.data,
    ...(parsed.data.auto !== undefined
      ? { auto: { ...(current.auto ?? {}), ...parsed.data.auto } }
      : {}),
  };
  config.update = UpdateConfigSchema.parse(merged);
  return { ok: true };
}

export function mergeGatewaySkillsMarketplacePatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = GatewaySkillsPatchSchema.safeParse(patch);
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
  if (parsed.data.skillsMarketplaceProvider !== undefined) {
    config.gateway.skillsMarketplaceProvider = parsed.data.skillsMarketplaceProvider.trim();
  }
  if (parsed.data.skillsStoreBaseUrl !== undefined) {
    config.gateway.skillsStoreBaseUrl = parsed.data.skillsStoreBaseUrl.trim().replace(/\/+$/, '');
  }
  return { ok: true };
}

export function resolveSessionConfigForWeb(config: Config) {
  const session = SessionConfigSchema.parse(config.session ?? {});
  return {
    dmScope: session.dmScope,
    storage: {
      pruneAfterDays:
        typeof session.storage?.pruneAfterMs === 'number'
          ? Math.max(0, Math.round(session.storage.pruneAfterMs / 86_400_000))
          : null,
      maxEntries: session.storage?.maxEntries ?? null,
    },
  };
}

export function resolveUpdateConfigForWeb(config: Config) {
  const update = config.update ?? { checkOnStart: true, channel: 'stable' as const };
  const auto = UpdateAutoConfigSchema.parse(update.auto ?? {});
  return {
    checkOnStart: update.checkOnStart !== false,
    channel: update.channel ?? 'stable',
    auto: {
      enabled: auto?.enabled === true,
      stableDelayHours: auto?.stableDelayHours ?? 6,
      stableJitterHours: auto?.stableJitterHours ?? 12,
      betaCheckIntervalHours: auto?.betaCheckIntervalHours ?? 1,
    },
  };
}
