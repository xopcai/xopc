import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export type DreamingLightConfigState = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  dedupeSimilarity: number;
};

export type DreamingDeepConfigState = {
  enabled: boolean;
  cron: string;
  minScore: number;
  minRecallCount: number;
  limit: number;
  recencyHalfLifeDays: number;
  maxAgeDays: number;
};

export type DreamingRemConfigState = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
};

export type DreamingConfigState = {
  enabled: boolean;
  frequency: string;
  timezone: string;
  /** @deprecated Use phases.deep.enabled */
  deepEnabled: boolean;
  /** @deprecated Use phases.deep.minScore */
  minScore: number;
  /** @deprecated Use phases.deep.minRecallCount */
  minRecallCount: number;
  /** @deprecated Use phases.deep.limit */
  limit: number;
  light: DreamingLightConfigState;
  deep: DreamingDeepConfigState;
  rem: DreamingRemConfigState;
};

const LIGHT_DEFAULTS: DreamingLightConfigState = {
  enabled: true,
  cron: '0 */6 * * *',
  lookbackDays: 1,
  limit: 50,
  dedupeSimilarity: 0.85,
};

const DEEP_DEFAULTS: DreamingDeepConfigState = {
  enabled: true,
  cron: '0 3 * * *',
  minScore: 0.8,
  minRecallCount: 3,
  limit: 10,
  recencyHalfLifeDays: 14,
  maxAgeDays: 30,
};

const REM_DEFAULTS: DreamingRemConfigState = {
  enabled: true,
  cron: '0 5 * * 0',
  lookbackDays: 7,
  limit: 20,
  minPatternStrength: 0.6,
};

const DEFAULTS: DreamingConfigState = {
  enabled: false,
  frequency: '0 3 * * *',
  timezone: '',
  deepEnabled: true,
  minScore: 0.8,
  minRecallCount: 3,
  limit: 10,
  light: LIGHT_DEFAULTS,
  deep: DEEP_DEFAULTS,
  rem: REM_DEFAULTS,
};

function clamp01(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toInt(n: unknown, fallback: number): number {
  const x = typeof n === 'string' ? Number(n) : (n as number);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.floor(x));
}

function toNum(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeDreamingFromConfig(config: unknown): DreamingConfigState {
  const c = isRecord(config) ? config : {};
  const memory = isRecord(c.memory) ? c.memory : {};
  const rootDreaming = isRecord(c.dreaming) ? c.dreaming : {};
  const directDreaming =
    typeof c.enabled === 'boolean' || typeof c.frequency === 'string' || isRecord(c.phases) ? c : {};
  const dreaming = isRecord(memory.dreaming)
    ? memory.dreaming
    : Object.keys(rootDreaming).length > 0
      ? rootDreaming
      : directDreaming;
  const phases = isRecord(dreaming.phases) ? dreaming.phases : {};
  const lightRaw = isRecord(phases.light) ? phases.light : {};
  const deepRaw = isRecord(phases.deep) ? phases.deep : {};
  const remRaw = isRecord(phases.rem) ? phases.rem : {};

  return {
    enabled: dreaming.enabled === true,
    frequency: typeof dreaming.frequency === 'string' && dreaming.frequency.trim() ? dreaming.frequency.trim() : DEFAULTS.frequency,
    timezone: typeof dreaming.timezone === 'string' ? dreaming.timezone : '',
    deepEnabled: deepRaw.enabled !== false,
    minScore: clamp01(typeof deepRaw.minScore === 'number' ? deepRaw.minScore : Number(deepRaw.minScore), DEFAULTS.minScore),
    minRecallCount: Math.max(1, toInt(deepRaw.minRecallCount, DEFAULTS.minRecallCount)),
    limit: toInt(deepRaw.limit, DEFAULTS.limit),
    light: {
      enabled: lightRaw.enabled !== false,
      cron: typeof lightRaw.cron === 'string' && lightRaw.cron.trim() ? lightRaw.cron.trim() : LIGHT_DEFAULTS.cron,
      lookbackDays: Math.max(1, toInt(lightRaw.lookbackDays, LIGHT_DEFAULTS.lookbackDays)),
      limit: toInt(lightRaw.limit, LIGHT_DEFAULTS.limit),
      dedupeSimilarity: clamp01(toNum(lightRaw.dedupeSimilarity, LIGHT_DEFAULTS.dedupeSimilarity), LIGHT_DEFAULTS.dedupeSimilarity),
    },
    deep: {
      enabled: deepRaw.enabled !== false,
      cron: typeof deepRaw.cron === 'string' && deepRaw.cron.trim() ? deepRaw.cron.trim() : DEEP_DEFAULTS.cron,
      minScore: clamp01(toNum(deepRaw.minScore, DEEP_DEFAULTS.minScore), DEEP_DEFAULTS.minScore),
      minRecallCount: Math.max(1, toInt(deepRaw.minRecallCount, DEEP_DEFAULTS.minRecallCount)),
      limit: toInt(deepRaw.limit, DEEP_DEFAULTS.limit),
      recencyHalfLifeDays: Math.max(1, toNum(deepRaw.recencyHalfLifeDays, DEEP_DEFAULTS.recencyHalfLifeDays)),
      maxAgeDays: Math.max(1, toNum(deepRaw.maxAgeDays, DEEP_DEFAULTS.maxAgeDays)),
    },
    rem: {
      enabled: remRaw.enabled !== false,
      cron: typeof remRaw.cron === 'string' && remRaw.cron.trim() ? remRaw.cron.trim() : REM_DEFAULTS.cron,
      lookbackDays: Math.max(1, toInt(remRaw.lookbackDays, REM_DEFAULTS.lookbackDays)),
      limit: toInt(remRaw.limit, REM_DEFAULTS.limit),
      minPatternStrength: clamp01(toNum(remRaw.minPatternStrength, REM_DEFAULTS.minPatternStrength), REM_DEFAULTS.minPatternStrength),
    },
  };
}

export async function patchDreamingConfig(
  agentId: string,
  state: DreamingConfigState,
  baseMemory: Record<string, unknown> | undefined,
): Promise<void> {
  const freq = state.frequency.trim();
  const tz = state.timezone.trim();

  await fetchJson(apiUrl(`/api/agents/${encodeURIComponent(agentId)}`), {
    method: 'PATCH',
    body: JSON.stringify({
      memory: {
        ...(baseMemory ?? {}),
        mode: state.enabled ? 'confirmWrite' : typeof baseMemory?.mode === 'string' ? baseMemory.mode : 'off',
        sources: Array.isArray(baseMemory?.sources) ? baseMemory.sources : ['session', 'curated', 'workspace'],
        writePolicy: isRecord(baseMemory?.writePolicy)
          ? baseMemory.writePolicy
          : { curated: 'confirm', workspace: 'confirm' },
        dreaming: {
          enabled: Boolean(state.enabled),
          ...(freq ? { frequency: freq } : {}),
          ...(tz ? { timezone: tz } : {}),
          phases: {
            light: {
              enabled: Boolean(state.light.enabled),
              ...(state.light.cron.trim() ? { cron: state.light.cron.trim() } : {}),
              lookbackDays: Math.max(1, Math.floor(state.light.lookbackDays)),
              limit: Math.max(0, Math.floor(state.light.limit)),
              dedupeSimilarity: clamp01(state.light.dedupeSimilarity, LIGHT_DEFAULTS.dedupeSimilarity),
            },
            deep: {
              enabled: Boolean(state.deep.enabled),
              ...(state.deep.cron.trim() ? { cron: state.deep.cron.trim() } : {}),
              minScore: clamp01(state.deep.minScore, DEEP_DEFAULTS.minScore),
              minRecallCount: Math.max(1, Math.floor(state.deep.minRecallCount)),
              limit: Math.max(0, Math.floor(state.deep.limit)),
              recencyHalfLifeDays: Math.max(1, state.deep.recencyHalfLifeDays),
              maxAgeDays: Math.max(1, state.deep.maxAgeDays),
            },
            rem: {
              enabled: Boolean(state.rem.enabled),
              ...(state.rem.cron.trim() ? { cron: state.rem.cron.trim() } : {}),
              lookbackDays: Math.max(1, Math.floor(state.rem.lookbackDays)),
              limit: Math.max(0, Math.floor(state.rem.limit)),
              minPatternStrength: clamp01(state.rem.minPatternStrength, REM_DEFAULTS.minPatternStrength),
            },
          },
        },
      },
    }),
  });

  void revalidateGatewayConfig();
}
