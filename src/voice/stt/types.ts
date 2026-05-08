/**
 * STT public types — data shapes consumed by downstream code (channels,
 * schema validation, gateway payloads).
 *
 * Provider implementations live behind `MediaUnderstandingProvider.transcribeAudio`
 * (see src/media-understanding/types.ts).
 */

export interface STTResult {
  /** Transcribed text. */
  text: string;
  /** Provider that performed the transcription (e.g. "alibaba", "openai"). */
  provider: string;
  /** Audio duration in seconds (if reported). */
  duration?: number;
  /** Detected language (if reported). */
  language?: string;
}

export interface STTOptions {
  /** Language hint (e.g. 'zh', 'en'). */
  language?: string;
  /** Model id (provider-specific). */
  model?: string;
}

/** STTConfig consumed by the schema and downstream wiring. */
export interface STTConfig {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: {
    apiKey?: string;
    model?: string;
  };
  openai?: {
    apiKey?: string;
    model?: string;
  };
  fallback?: {
    enabled: boolean;
    order: ('alibaba' | 'openai')[];
  };
  /** Hard timeout per provider call (ms). Default 60s. */
  timeoutMs?: number;
}

export type STTProviderAttemptOutcome = 'success' | 'skipped' | 'failed';

export type STTProviderFailureReason =
  | 'success'
  | 'not_configured'
  | 'timeout'
  | 'provider_error'
  | 'unsupported_format'
  | 'unknown';

export interface STTProviderAttempt {
  provider: string;
  outcome: STTProviderAttemptOutcome;
  reasonCode: STTProviderFailureReason;
  latencyMs: number;
  error?: string;
}

export interface STTResultWithTracking extends STTResult {
  attempts: STTProviderAttempt[];
  fallbackFrom?: string;
  attemptedProviders: string[];
}

export const DEFAULT_STT_CONFIG: STTConfig = {
  enabled: false,
  provider: 'alibaba',
  alibaba: {
    model: 'paraformer-v2',
  },
  openai: {
    model: 'whisper-1',
  },
  fallback: {
    enabled: true,
    order: ['alibaba', 'openai'],
  },
  timeoutMs: 60_000,
};
