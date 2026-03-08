/**
 * STT Types and Interfaces
 */

export interface STTResult {
  /** Transcribed text */
  text: string;
  /** Provider that performed the transcription */
  provider: string;
  /** Audio duration in seconds (if available) */
  duration?: number;
  /** Language detected (if available) */
  language?: string;
}

export interface STTOptions {
  /** Language hint (e.g., 'zh', 'en') */
  language?: string;
  /** Model to use (provider-specific) */
  model?: string;
}

export interface STTProvider {
  /** Provider name */
  name: string;
  /** Transcribe audio buffer to text */
  transcribe(audioBuffer: Buffer, options?: STTOptions): Promise<STTResult>;
  /** Check if provider is configured */
  isConfigured(): boolean;
}

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
}

/**
 * Default STT configuration
 */
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
};