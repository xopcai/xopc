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
  return {
    enabled: false,
    memoryNudgeInterval: 10,
    skillNudgeInterval: 10,
    maxToolRounds: 8,
    maxHistoryMessages: 80,
    maxDurationMs: 120_000,
  };
}
