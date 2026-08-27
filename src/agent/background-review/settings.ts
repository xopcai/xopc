import type { Config } from '../../config/schema.js';

export interface BackgroundReviewSettings {
  enabled: boolean;
  adaptiveCadence: boolean;
  reviewIntervalTurns: number;
  maxHistoryMessages: number;
  maxDurationMs: number;
}

const DEFAULT_SETTINGS: BackgroundReviewSettings = {
  enabled: false,
  adaptiveCadence: true,
  reviewIntervalTurns: 10,
  maxHistoryMessages: 80,
  maxDurationMs: 120_000,
};

export function resolveBackgroundReviewSettings(
  config: Config | undefined,
): BackgroundReviewSettings {
  if (!config) return DEFAULT_SETTINGS;

  const { understanding } = config.userContext;
  return {
    enabled: config.userContext.enabled && understanding.enabled,
    adaptiveCadence: understanding.adaptiveCadence,
    reviewIntervalTurns: understanding.reviewIntervalTurns,
    maxHistoryMessages: understanding.maxHistoryMessages,
    maxDurationMs: understanding.maxDurationMs,
  };
}
