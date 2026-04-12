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
  const br = config?.agents?.defaults?.backgroundReview;
  return {
    enabled: br?.enabled === true,
    memoryNudgeInterval: br?.memoryNudgeInterval ?? 10,
    skillNudgeInterval: br?.skillNudgeInterval ?? 10,
    maxToolRounds: br?.maxToolRounds ?? 8,
    maxHistoryMessages: br?.maxHistoryMessages ?? 80,
    maxDurationMs: br?.maxDurationMs ?? 120_000,
  };
}
