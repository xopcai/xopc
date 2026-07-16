import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentManifestForSession } from '../../config/agent-profile.js';

export interface BackgroundReviewSettings {
  enabled: boolean;
  agentId?: string;
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
  sessionKey?: string,
): BackgroundReviewSettings {
  if (!config) return DEFAULT_SETTINGS;

  try {
    const manifest = resolveEffectiveAgentManifestForSession(config, sessionKey);
    const memory = manifest.memory;
    const understanding = memory.understanding;
    const writeCapable = memory.mode === 'confirmWrite' || memory.mode === 'auto';
    return {
      enabled: writeCapable && (understanding?.enabled ?? true),
      agentId: manifest.id,
      adaptiveCadence: understanding?.adaptiveCadence ?? true,
      reviewIntervalTurns: understanding?.reviewIntervalTurns ?? DEFAULT_SETTINGS.reviewIntervalTurns,
      maxHistoryMessages: understanding?.maxHistoryMessages ?? DEFAULT_SETTINGS.maxHistoryMessages,
      maxDurationMs: understanding?.maxDurationMs ?? DEFAULT_SETTINGS.maxDurationMs,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
