/**
 * TTS (Text-to-Speech) Types
 */

export type TTSProvider = 'openai' | 'alibaba' | 'edge';

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
  /** Allow model to override TTS parameters */
  modelOverrides?: TTSModelOverrideConfig;
  alibaba?: {
    apiKey?: string;
    model?: string;
    voice?: string;
  };
  openai?: {
    apiKey?: string;
    model?: string;
    voice?: string;
  };
  edge?: {
    enabled?: boolean;
    voice?: string;
    lang?: string;
    outputFormat?: string;
    pitch?: string;
    rate?: string;
    volume?: string;
    proxy?: string;
    timeoutMs?: number;
  };
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  provider: 'openai',
  trigger: 'always',
  fallback: {
    enabled: true,
    order: ['openai', 'alibaba', 'edge'],
  },
  maxTextLength: 4096,
  timeoutMs: 30000,
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
  alibaba: {
    model: 'qwen-tts',
    voice: 'Cherry',
  },
  openai: {
    model: 'tts-1',
    voice: 'alloy',
  },
  edge: {
    enabled: true,
    voice: 'en-US-MichelleNeural',
    lang: 'en-US',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
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
}
