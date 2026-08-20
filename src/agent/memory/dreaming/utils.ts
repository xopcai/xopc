import type { DreamingDeepConfig } from './config.js';
import {
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
} from './constants.js';

export type DeepExecutionConfig = Omit<DreamingDeepConfig, 'schedule'>;

function toPositiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored > 0 ? floored : fallback;
}

function toNonNegInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored >= 0 ? floored : fallback;
}

function clampScore(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function resolveDeepDefaults(overrides?: Partial<DeepExecutionConfig>): DeepExecutionConfig {
  return {
    enabled: overrides?.enabled !== false,
    minScore: clampScore(Number(overrides?.minScore), 0.8),
    minRecallCount: toPositiveInt(overrides?.minRecallCount, 3),
    minUniqueQueries: toPositiveInt(overrides?.minUniqueQueries, 3),
    limit: toNonNegInt(overrides?.limit, 10),
    recencyHalfLifeDays: toPositiveInt(overrides?.recencyHalfLifeDays, DEFAULT_RECENCY_HALF_LIFE_DAYS),
    maxAgeDays: toPositiveInt(overrides?.maxAgeDays, DEFAULT_MAX_AGE_DAYS),
  };
}
