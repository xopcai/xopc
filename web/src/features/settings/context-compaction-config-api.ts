import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ContextCompactionConfigState = {
  enabled: boolean;
  triggerThreshold: number;
  reserveTokens: number;
  minMessagesBeforeCompact: number;
  keepRecentTokens: number;
  recentTurnsPreserve: number;
  summaryMaxTokens: number;
  summaryChunkTokens: number;
  summaryTimeoutMs: number;
  summaryRetries: number;
  qualityGuard: boolean;
  model?: string;
  minToolResultKeepChars: number;
  maxActiveTranscriptBytes: number;
  postCompactionSections: string[];
};

export const DEFAULT_CONTEXT_COMPACTION_CONFIG: ContextCompactionConfigState = {
  enabled: true,
  triggerThreshold: 0.8,
  reserveTokens: 8_192,
  minMessagesBeforeCompact: 10,
  keepRecentTokens: 20_000,
  recentTurnsPreserve: 3,
  summaryMaxTokens: 2_000,
  summaryChunkTokens: 24_000,
  summaryTimeoutMs: 180_000,
  summaryRetries: 2,
  qualityGuard: true,
  minToolResultKeepChars: 1_000,
  maxActiveTranscriptBytes: 2_000_000,
  postCompactionSections: ['Session Startup', 'Red Lines'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : fallback;
}

export function normalizeContextCompactionFromConfig(config: unknown): ContextCompactionConfigState {
  const root = isRecord(config) ? config : {};
  const userContext = isRecord(root.userContext) ? root.userContext : {};
  const memory = isRecord(userContext.memory) ? userContext.memory : {};
  const retention = isRecord(memory.retention) ? memory.retention : {};
  const raw = isRecord(retention.compaction) ? retention.compaction : {};
  const defaults = DEFAULT_CONTEXT_COMPACTION_CONFIG;
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : undefined;
  const postCompactionSections = Array.isArray(raw.postCompactionSections)
    && raw.postCompactionSections.length <= 12
    && raw.postCompactionSections.every((value) => typeof value === 'string' && value.trim())
    ? [...new Set(raw.postCompactionSections.map((value) => (value as string).trim()))]
    : [...defaults.postCompactionSections];

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    triggerThreshold: boundedNumber(raw.triggerThreshold, defaults.triggerThreshold, 0.1, 0.98),
    reserveTokens: boundedInteger(raw.reserveTokens, defaults.reserveTokens, 1_024),
    minMessagesBeforeCompact: boundedInteger(
      raw.minMessagesBeforeCompact,
      defaults.minMessagesBeforeCompact,
      2,
    ),
    keepRecentTokens: boundedInteger(raw.keepRecentTokens, defaults.keepRecentTokens, 1_000),
    recentTurnsPreserve: boundedInteger(raw.recentTurnsPreserve, defaults.recentTurnsPreserve, 1, 12),
    summaryMaxTokens: boundedInteger(raw.summaryMaxTokens, defaults.summaryMaxTokens, 256),
    summaryChunkTokens: boundedInteger(raw.summaryChunkTokens, defaults.summaryChunkTokens, 1_000),
    summaryTimeoutMs: boundedInteger(raw.summaryTimeoutMs, defaults.summaryTimeoutMs, 1_000, 600_000),
    summaryRetries: boundedInteger(raw.summaryRetries, defaults.summaryRetries, 0, 5),
    qualityGuard: typeof raw.qualityGuard === 'boolean' ? raw.qualityGuard : defaults.qualityGuard,
    ...(model ? { model } : {}),
    minToolResultKeepChars: boundedInteger(
      raw.minToolResultKeepChars,
      defaults.minToolResultKeepChars,
      200,
    ),
    maxActiveTranscriptBytes: boundedInteger(
      raw.maxActiveTranscriptBytes,
      defaults.maxActiveTranscriptBytes,
      64_000,
    ),
    postCompactionSections,
  };
}

export function validateContextCompactionConfig(
  state: ContextCompactionConfigState,
): keyof ContextCompactionConfigState | null {
  if (state.triggerThreshold < 0.1 || state.triggerThreshold > 0.98) return 'triggerThreshold';
  if (!Number.isInteger(state.reserveTokens) || state.reserveTokens < 1_024) return 'reserveTokens';
  if (!Number.isInteger(state.minMessagesBeforeCompact) || state.minMessagesBeforeCompact < 2) {
    return 'minMessagesBeforeCompact';
  }
  if (!Number.isInteger(state.keepRecentTokens) || state.keepRecentTokens < 1_000) return 'keepRecentTokens';
  if (!Number.isInteger(state.recentTurnsPreserve)
    || state.recentTurnsPreserve < 1
    || state.recentTurnsPreserve > 12) {
    return 'recentTurnsPreserve';
  }
  if (!Number.isInteger(state.summaryMaxTokens) || state.summaryMaxTokens < 256) return 'summaryMaxTokens';
  if (!Number.isInteger(state.summaryChunkTokens) || state.summaryChunkTokens < 1_000) {
    return 'summaryChunkTokens';
  }
  if (!Number.isInteger(state.summaryTimeoutMs)
    || state.summaryTimeoutMs < 1_000
    || state.summaryTimeoutMs > 600_000) {
    return 'summaryTimeoutMs';
  }
  if (!Number.isInteger(state.summaryRetries) || state.summaryRetries < 0 || state.summaryRetries > 5) {
    return 'summaryRetries';
  }
  if (state.model !== undefined && !state.model.trim()) return 'model';
  if (!Number.isInteger(state.minToolResultKeepChars) || state.minToolResultKeepChars < 200) {
    return 'minToolResultKeepChars';
  }
  if (!Number.isInteger(state.maxActiveTranscriptBytes) || state.maxActiveTranscriptBytes < 64_000) {
    return 'maxActiveTranscriptBytes';
  }
  if (state.postCompactionSections.length > 12
    || state.postCompactionSections.some((section) => !section.trim())) {
    return 'postCompactionSections';
  }
  return null;
}

export function buildContextCompactionPatch(state: ContextCompactionConfigState) {
  const compaction = {
    ...state,
    ...(state.model?.trim() ? { model: state.model.trim() } : {}),
  };
  if (!state.model?.trim()) delete compaction.model;
  return {
    userContext: {
      memory: {
        retention: {
          compaction,
        },
      },
    },
  };
}

export async function patchContextCompactionConfig(
  state: ContextCompactionConfigState,
): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify(buildContextCompactionPatch(state)),
  });
  await revalidateGatewayConfig();
}
