/**
 * TTS (Text-to-Speech) Types
 */

/** Built-in provider ids shipped in core. Extensions add more at runtime. */
export type BuiltinTTSProvider = 'openai' | 'alibaba' | 'edge' | 'minimax' | 'tts-local-cli';

/** Any registered SpeechProviderPlugin id (built-in or extension). */
export type TTSProvider = string;

export type TTSAutoMode = 'off' | 'always' | 'inbound' | 'tagged';

export interface TTSOptions {
  /** Voice ID */
  voice?: string;
  /** Speed (0.25 - 4.0) */
  speed?: number;
  /** Output format */
  format?: 'opus' | 'mp3' | 'wav';
  /** Model ID (for provider-specific model selection) */
  model?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

export interface TTSResult {
  /** Audio buffer */
  audio: Buffer;
  /** Format */
  format: string;
  /** Duration in seconds (if available) */
  duration?: number;
  /** Provider that generated the speech */
  provider: string;
}

export interface TTSProviderInterface {
  /** Provider name */
  name: string;
  /** Convert text to speech */
  speak(text: string, options?: TTSOptions): Promise<TTSResult>;
  /** Check if provider is configured */
  isConfigured(): boolean;
}

export interface TTSModelOverrideConfig {
  /** Enable model-provided overrides for TTS */
  enabled?: boolean;
  /** Allow model-provided TTS text blocks */
  allowText?: boolean;
  /** Allow model-provided provider override (default: false) */
  allowProvider?: boolean;
  /** Allow model-provided voice/voiceId override */
  allowVoice?: boolean;
  /** Allow model-provided modelId override */
  allowModelId?: boolean;
  /** Allow model-provided voice settings override */
  allowVoiceSettings?: boolean;
  /** Allow model-provided normalization or language overrides */
  allowNormalization?: boolean;
  /** Allow model-provided seed override */
  allowSeed?: boolean;
}

export interface TTSConfig {
  enabled: boolean;
  provider: TTSProvider;
  /** Trigger mode: auto = reply with voice when user sends voice */
  trigger: TTSAutoMode;
  /** Fallback configuration */
  fallback?: {
    enabled: boolean;
    order: TTSProvider[];
  };
  /** Maximum text length for TTS */
  maxTextLength?: number;
  /** API request timeout (ms) */
  timeoutMs?: number;
  /** Long-text summarization before TTS */
  summarization?: TTSSummarizationConfig;
  /** Allow model to override TTS parameters */
  modelOverrides?: TTSModelOverrideConfig;
  /** Provider settings map (`messages.tts.providers.<id>`). */
  providers?: Record<string, Record<string, unknown>>;
}

export interface TTSSummarizationConfig {
  /** When true (default), long text is summarized via LLM before TTS */
  enabled?: boolean;
  targetLength?: number;
  threshold?: number;
  model?: string;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: true,
  provider: 'edge',
  trigger: 'inbound',
  fallback: {
    enabled: true,
    order: ['openai', 'alibaba', 'minimax', 'edge'],
  },
  maxTextLength: 512, // Conservative default to accommodate all providers (Alibaba limit is 512)
  timeoutMs: 60000,
  summarization: {
    enabled: true,
  },
  modelOverrides: {
    enabled: true,
    allowText: true,
    allowProvider: false,
    allowVoice: true,
    allowModelId: true,
    allowVoiceSettings: false,
    allowNormalization: false,
    allowSeed: false,
  },
  providers: {
    alibaba: { model: 'qwen-tts', voice: 'Cherry' },
    openai: { model: 'tts-1', voice: 'alloy' },
    edge: {
      enabled: true,
      voice: 'en-US-MichelleNeural',
      lang: 'en-US',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    },
    minimax: { model: 'speech-2.8-hd', voice: 'male-qn-qingse' },
  },
};

/** TTS directive parse result */
export interface TtsDirectiveParseResult {
  cleanedText: string;
  ttsText?: string;
  hasDirective: boolean;
  overrides: TtsDirectiveOverrides;
  warnings: string[];
}

/** TTS directive overrides */
export interface TtsDirectiveOverrides {
  ttsText?: string;
  provider?: TTSProvider;
  openai?: {
    voice?: string;
    model?: string;
  };
  alibaba?: {
    voice?: string;
    model?: string;
  };
  edge?: {
    voice?: string;
  };
  minimax?: {
    voice?: string;
    model?: string;
  };
}

/** Provider attempt result (TTS fallback chain) */
export type ProviderAttemptOutcome = 'success' | 'skipped' | 'failed';

/** Provider failure reason classification */
export type ProviderFailureReason =
  | 'success'
  | 'not_configured'
  | 'timeout'
  | 'provider_error'
  | 'text_too_long'
  | 'unknown';

/** Single provider attempt in a TTS fallback chain */
export interface ProviderAttempt {
  provider: string;
  outcome: ProviderAttemptOutcome;
  reasonCode: ProviderFailureReason;
  latencyMs: number;
  error?: string;
}

/** TTS result including fallback / preprocessing metadata */
export interface TTSResultWithTracking extends TTSResult {
  attempts: ProviderAttempt[];
  fallbackFrom?: string;
  attemptedProviders: string[];
  wasPreprocessed?: boolean;
  ttsText?: string;
  wasSummarized?: boolean;
}

/** Last TTS call diagnostics (memory-only) */
export interface TtsStatusEntry {
  timestamp: number;
  success: boolean;
  provider?: string;
  latencyMs?: number;
  error?: string;
  textLength?: number;
  audioSize?: number;
  audioFormat?: string;
  usedFallback?: boolean;
  wasSummarized?: boolean;
}

export interface TtsRuntimeStatus {
  lastAttempt?: TtsStatusEntry;
  recentSuccessRate?: number;
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
}
