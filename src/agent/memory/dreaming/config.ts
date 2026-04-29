import type { Config } from '../../../config/schema.js';
import {
  DEFAULT_DEEP_CRON,
  DEFAULT_LIGHT_CRON,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  DEFAULT_REM_CRON,
  type DreamingPhaseId,
} from './constants.js';

// ── Phase config types ─────────────────────────────────────────────────

export type DreamingLightConfig = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  dedupeSimilarity: number;
};

export type DreamingDeepConfig = {
  enabled: boolean;
  cron: string;
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
  limit: number;
  recencyHalfLifeDays: number;
  maxAgeDays: number;
};

export type DreamingRemConfig = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
};

export type DreamingResolvedConfig = {
  enabled: boolean;
  frequency: string;
  timezone?: string;
  phases: {
    light: DreamingLightConfig;
    deep: DreamingDeepConfig;
    rem: DreamingRemConfig;
  };
  deep: DreamingDeepConfig;
};

// ── Helpers ────────────────────────────────────────────────────────────

function clampScore(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function toPositiveInt(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored > 0 ? floored : fallback;
}

function toNonNegInt(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored >= 0 ? floored : fallback;
}

function trimmedStringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ── Resolver ───────────────────────────────────────────────────────────

/**
 * Resolve the full three-phase dreaming config from the app Config.
 *
 * Reads through `any` so it can ship independently of the schema evolution.
 * Expected shape: `agents.defaults.memory.dreaming.{ enabled, frequency, timezone, phases.{light,deep,rem}.* }`
 */
export function resolveDreamingConfig(cfg: Config | undefined): DreamingResolvedConfig {
  const anyCfg = cfg as any;
  const dreaming = anyCfg?.agents?.defaults?.memory?.dreaming;
  const enabled = dreaming?.enabled === true;

  const frequency = trimmedStringOr(dreaming?.frequency, DEFAULT_DEEP_CRON);
  const timezone = optionalTrimmedString(dreaming?.timezone);

  // ── Light phase ────────────────────────────────────────────────────
  const lightRaw = dreaming?.phases?.light ?? {};
  const light: DreamingLightConfig = {
    enabled: enabled && lightRaw?.enabled !== false,
    cron: trimmedStringOr(lightRaw?.cron, DEFAULT_LIGHT_CRON),
    lookbackDays: toPositiveInt(lightRaw?.lookbackDays, 2),
    limit: toNonNegInt(lightRaw?.limit, 100),
    dedupeSimilarity: clampScore(Number(lightRaw?.dedupeSimilarity), 0.9),
  };

  // ── Deep phase ─────────────────────────────────────────────────────
  const deepRaw = dreaming?.phases?.deep ?? dreaming?.deep ?? {};
  const deep: DreamingDeepConfig = {
    enabled: enabled && deepRaw?.enabled !== false,
    cron: trimmedStringOr(deepRaw?.cron, frequency),
    minScore: clampScore(Number(deepRaw?.minScore), 0.8),
    minRecallCount: toPositiveInt(deepRaw?.minRecallCount, 3),
    minUniqueQueries: toPositiveInt(deepRaw?.minUniqueQueries, 3),
    limit: toNonNegInt(deepRaw?.limit, 10),
    recencyHalfLifeDays: toPositiveInt(deepRaw?.recencyHalfLifeDays, DEFAULT_RECENCY_HALF_LIFE_DAYS),
    maxAgeDays: toPositiveInt(deepRaw?.maxAgeDays, DEFAULT_MAX_AGE_DAYS),
  };

  // ── REM phase ──────────────────────────────────────────────────────
  const remRaw = dreaming?.phases?.rem ?? {};
  const rem: DreamingRemConfig = {
    enabled: enabled && remRaw?.enabled !== false,
    cron: trimmedStringOr(remRaw?.cron, DEFAULT_REM_CRON),
    lookbackDays: toPositiveInt(remRaw?.lookbackDays, 7),
    limit: toNonNegInt(remRaw?.limit, 10),
    minPatternStrength: clampScore(Number(remRaw?.minPatternStrength), 0.75),
  };

  return {
    enabled,
    frequency,
    ...(timezone ? { timezone } : {}),
    phases: { light, deep, rem },
    // Backward-compat alias:
    deep,
  };
}

/** Get the cron expression for a specific phase from resolved config. */
export function getPhaseCron(config: DreamingResolvedConfig, phase: DreamingPhaseId): string {
  return config.phases[phase].cron;
}

/** Check if a specific phase is enabled (global + phase-level). */
export function isPhaseEnabled(config: DreamingResolvedConfig, phase: DreamingPhaseId): boolean {
  return config.enabled && config.phases[phase].enabled;
}

