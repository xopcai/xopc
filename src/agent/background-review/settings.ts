import type { Config } from '../../config/schema.js';

export interface BackgroundReviewSettings {
  enabled: boolean;
  memoryNudgeInterval: number;
  skillNudgeInterval: number;
  maxToolRounds: number;
  maxHistoryMessages: number;
  maxDurationMs: number;
}

export function resolveBackgroundReviewSettings(config: Config | undefined): BackgroundReviewSettings {
  const raw = (config?.agents as unknown as {
    defaults?: {
      backgroundReview?: Partial<BackgroundReviewSettings>;
    };
  } | undefined)?.defaults?.backgroundReview;
  const numberOrDefault = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

  return {
    enabled: raw?.enabled === true,
    memoryNudgeInterval: numberOrDefault(raw?.memoryNudgeInterval, 10),
    skillNudgeInterval: numberOrDefault(raw?.skillNudgeInterval, 10),
    maxToolRounds: numberOrDefault(raw?.maxToolRounds, 8),
    maxHistoryMessages: numberOrDefault(raw?.maxHistoryMessages, 80),
    maxDurationMs: numberOrDefault(raw?.maxDurationMs, 120_000),
  };
}
