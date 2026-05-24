import { z } from 'zod';

import type { Config } from './schema.js';
import {
  CronConfigSchema,
  GoalsConfigSchema,
  SessionConfigSchema,
  SessionDmScopeSchema,
} from './schema.js';

const CronConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxConcurrentJobs: z.number().int().min(1).max(100).optional(),
  defaultTimezone: z.string().min(1).optional(),
  historyRetentionDays: z.number().int().min(1).max(365).optional(),
  enableMetrics: z.boolean().optional(),
});

const GoalsConfigPatchSchema = z.object({
  maxTurns: z.number().int().min(1).max(500).optional(),
  judgeModelRef: z.string().optional(),
  checklistMode: z.boolean().optional(),
  maxConsecutiveParseFailures: z.number().int().min(1).max(20).optional(),
  judgeTimeoutMs: z.number().int().min(5_000).max(120_000).optional(),
  checklistHistoryChars: z.number().int().min(0).max(100_000).optional(),
});

const SessionStoragePatchSchema = z.object({
  pruneAfterMs: z.number().int().min(0).optional(),
  maxEntries: z.number().int().min(1).optional(),
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

export function mergeCronConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = CronConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  config.cron = {
    ...(config.cron ?? CronConfigSchema.parse({})),
    ...parsed.data,
  };
  return { ok: true };
}

export function mergeGoalsConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = GoalsConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  config.goals = {
    ...(config.goals ?? GoalsConfigSchema.parse({})),
    ...parsed.data,
  };
  return { ok: true };
}

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
  if (parsed.data.storage) {
    next.storage = { ...(current.storage ?? {}), ...parsed.data.storage };
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
  const next = { ...current, ...parsed.data };
  if (parsed.data.auto) {
    next.auto = { ...(current.auto ?? {}), ...parsed.data.auto };
  }
  config.update = next;
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
      host: '127.0.0.1',
      port: 18790,
      auth: { mode: 'token' },
      heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
      maxSseConnections: 100,
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

export function resolveGoalsConfigForWeb(config: Config) {
  return GoalsConfigSchema.parse(config.goals ?? {});
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
  const auto = update.auto ?? {};
  return {
    checkOnStart: update.checkOnStart !== false,
    channel: update.channel ?? 'stable',
    auto: {
      enabled: auto.enabled === true,
      stableDelayHours: auto.stableDelayHours ?? 6,
      stableJitterHours: auto.stableJitterHours ?? 12,
      betaCheckIntervalHours: auto.betaCheckIntervalHours ?? 1,
    },
  };
}

export function resolveCronConfigForWeb(config: Config) {
  const cron = CronConfigSchema.parse(config.cron ?? {});
  return {
    enabled: cron.enabled !== false,
    maxConcurrentJobs: cron.maxConcurrentJobs ?? 5,
    defaultTimezone: cron.defaultTimezone ?? 'UTC',
    historyRetentionDays: cron.historyRetentionDays ?? 7,
    enableMetrics: cron.enableMetrics !== false,
  };
}
