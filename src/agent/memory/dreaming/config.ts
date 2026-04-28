import type { Config } from '../../../config/schema.js';

export type DreamingResolvedConfig = {
  enabled: boolean;
  frequency: string;
  timezone?: string;
  deep: {
    enabled: boolean;
    minScore: number;
    minRecallCount: number;
    limit: number;
  };
};

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

/**
 * Dreaming config resolver.
 *
 * NOTE: This reads config through `any` so it can ship before the full schema lands.
 * Expected shape:
 * `agents.defaults.memory.dreaming.{ enabled, frequency, timezone, phases.deep.{minScore,minRecallCount,limit} }`
 */
export function resolveDreamingConfig(cfg: Config | undefined): DreamingResolvedConfig {
  const anyCfg = cfg as any;
  const dreaming = anyCfg?.agents?.defaults?.memory?.dreaming;
  const enabled = dreaming?.enabled === true;

  const frequency =
    typeof dreaming?.frequency === 'string' && dreaming.frequency.trim()
      ? dreaming.frequency.trim()
      : '0 3 * * *';
  const timezone =
    typeof dreaming?.timezone === 'string' && dreaming.timezone.trim()
      ? dreaming.timezone.trim()
      : undefined;

  const deep = dreaming?.phases?.deep ?? dreaming?.deep ?? {};
  const deepEnabled = deep?.enabled !== false;
  const minScore = clampScore(Number(deep?.minScore), 0.8);
  const minRecallCount = toPositiveInt(deep?.minRecallCount, 3);
  const limit = toPositiveInt(deep?.limit, 10);

  return {
    enabled,
    frequency,
    ...(timezone ? { timezone } : {}),
    deep: {
      enabled: enabled && deepEnabled,
      minScore,
      minRecallCount,
      limit,
    },
  };
}

