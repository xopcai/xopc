import type { Config } from '../../../config/schema.js';
import type { DreamingMode } from '../../../storage/sqlite/index.js';
import type { DreamingSchedule, DreamingSettings } from '../../../user-context/config.js';
import {
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  type DreamingPhaseId,
} from './constants.js';
import { DEFAULT_DREAMING_SCHEDULES, resolveDreamingTimezone } from './schedule.js';

// ── Phase config types ─────────────────────────────────────────────────

export type DreamingLightConfig = {
  enabled: boolean;
  schedule: DreamingSchedule;
  lookbackDays: number;
  limit: number;
};

export type DreamingDeepConfig = {
  enabled: boolean;
  schedule: DreamingSchedule;
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
  limit: number;
  recencyHalfLifeDays: number;
  maxAgeDays: number;
};

export type DreamingRemConfig = {
  enabled: boolean;
  schedule: DreamingSchedule;
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
};

export type DreamingResolvedConfig = {
  requestedMode: DreamingMode;
  mode: DreamingMode;
  enabled: boolean;
  writeDisposition: 'none' | 'candidate' | 'active';
  automaticReady: boolean;
  downgradeReason?: 'memory_policy' | 'quality_gate';
  timezone: string;
  phases: {
    light: DreamingLightConfig;
    deep: DreamingDeepConfig;
    rem: DreamingRemConfig;
  };
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

// ── Resolver ───────────────────────────────────────────────────────────

export function resolveDreamingSettings(cfg: Config | undefined): DreamingSettings {
  const dreaming = cfg?.userContext.dreaming;
  return {
    mode: dreaming?.mode ?? 'off',
    timezone: resolveDreamingTimezone(dreaming?.timezone),
    phases: {
      light: {
        enabled: dreaming?.phases?.light?.enabled !== false,
        schedule: dreaming?.phases?.light?.schedule ?? DEFAULT_DREAMING_SCHEDULES.light,
      },
      deep: {
        enabled: dreaming?.phases?.deep?.enabled !== false,
        schedule: dreaming?.phases?.deep?.schedule ?? DEFAULT_DREAMING_SCHEDULES.deep,
      },
      rem: {
        enabled: dreaming?.phases?.rem?.enabled !== false,
        schedule: dreaming?.phases?.rem?.schedule ?? DEFAULT_DREAMING_SCHEDULES.rem,
      },
    },
  };
}

/** Resolve the full three-phase dreaming config and its effective write authority. */
export function resolveDreamingConfig(
  cfg: Config | undefined,
  options: { automaticReady?: boolean } = {},
): DreamingResolvedConfig {
  const dreaming = cfg?.userContext.dreaming;
  const settings = resolveDreamingSettings(cfg);
  const requestedMode = settings.mode;
  const memoryMode = cfg?.userContext.memory.mode ?? 'off';
  const automaticReady = options.automaticReady === true;
  const mode: DreamingMode = cfg?.userContext.enabled !== true || memoryMode === 'off'
    ? 'off'
    : memoryMode === 'readOnly'
      ? (requestedMode === 'off' ? 'off' : 'observe')
      : memoryMode === 'confirmWrite' && requestedMode === 'automatic'
        ? 'review'
        : requestedMode === 'automatic' && !automaticReady
          ? 'review'
          : requestedMode;
  const enabled = mode !== 'off';
  const writeDisposition = mode === 'automatic' ? 'active' : mode === 'review' ? 'candidate' : 'none';
  const timezone = settings.timezone;

  // ── Light phase ────────────────────────────────────────────────────
  const lightRaw = dreaming?.phases?.light ?? {};
  const light: DreamingLightConfig = {
    enabled: enabled && settings.phases.light.enabled,
    schedule: settings.phases.light.schedule,
    lookbackDays: toPositiveInt(lightRaw?.lookbackDays, 2),
    limit: toNonNegInt(lightRaw?.limit, 100),
  };

  // ── Deep phase ─────────────────────────────────────────────────────
  const deepRaw = dreaming?.phases?.deep ?? {};
  const deep: DreamingDeepConfig = {
    enabled: enabled && settings.phases.deep.enabled,
    schedule: settings.phases.deep.schedule,
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
    enabled: enabled && settings.phases.rem.enabled,
    schedule: settings.phases.rem.schedule,
    lookbackDays: toPositiveInt(remRaw?.lookbackDays, 7),
    limit: toNonNegInt(remRaw?.limit, 10),
    minPatternStrength: clampScore(Number(remRaw?.minPatternStrength), 0.75),
  };

  return {
    requestedMode,
    mode,
    enabled,
    writeDisposition,
    automaticReady,
    ...(requestedMode === 'automatic' && mode !== 'automatic'
      ? { downgradeReason: memoryMode === 'confirmWrite' || memoryMode === 'readOnly' ? 'memory_policy' as const : 'quality_gate' as const }
      : {}),
    timezone,
    phases: { light, deep, rem },
  };
}

/** Check if a specific phase is enabled (global + phase-level). */
export function isPhaseEnabled(config: DreamingResolvedConfig, phase: DreamingPhaseId): boolean {
  return config.enabled && config.phases[phase].enabled;
}
