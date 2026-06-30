import type { Config } from '../../config/schema.js';

export interface BackgroundReviewSettings {
  enabled: boolean;
  memoryNudgeInterval: number;
  skillNudgeInterval: number;
  maxToolRounds: number;
  maxHistoryMessages: number;
  maxDurationMs: number;
}

export function resolveBackgroundReviewSettings(_config: Config | undefined): BackgroundReviewSettings {
  const numberOrDefault = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

  return {
    enabled: false,
    memoryNudgeInterval: numberOrDefault(undefined, 10),
    skillNudgeInterval: numberOrDefault(undefined, 10),
    maxToolRounds: numberOrDefault(undefined, 8),
    maxHistoryMessages: numberOrDefault(undefined, 80),
    maxDurationMs: numberOrDefault(undefined, 120_000),
  };
}
