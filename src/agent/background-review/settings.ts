import type { Config } from '../../config/schema.js';

export interface BackgroundReviewSettings {
  enabled: boolean;
  reviewIntervalTurns: number;
  maxHistoryMessages: number;
  maxDurationMs: number;
}

const DEFAULT_SETTINGS: BackgroundReviewSettings = {
  enabled: false,
  reviewIntervalTurns: 10,
  maxHistoryMessages: 80,
  maxDurationMs: 120_000,
};

export function resolveBackgroundReviewSettings(
  config: Config | undefined,
): BackgroundReviewSettings {
  if (!config) return DEFAULT_SETTINGS;

  const userModel = config.userContext.userModel;
  const extraction = userModel.extraction;
  return {
    enabled: config.userContext.enabled && userModel.enabled,
    reviewIntervalTurns: extraction.reviewIntervalTurns,
    maxHistoryMessages: extraction.maxHistoryMessages,
    maxDurationMs: extraction.maxDurationMs,
  };
}
