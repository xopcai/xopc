/**
 * TTS (Text-to-Speech) Types
 */

export interface TTSOptions {
  /** Voice ID */
  voice?: string;
  /** Speed (0.25 - 4.0) */
  speed?: number;
  /** Output format */
  format?: 'opus' | 'mp3' | 'wav';
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

export interface TTSProvider {
  /** Provider name */
  name: string;
  /** Convert text to speech */
  speak(text: string, options?: TTSOptions): Promise<TTSResult>;
  /** Check if provider is configured */
  isConfigured(): boolean;
}

export interface TTSConfig {
  enabled: boolean;
  provider: 'openai' | 'alibaba';
  /** Trigger mode: auto = reply with voice when user sends voice */
  trigger: 'auto' | 'never';
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
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  provider: 'openai',
  trigger: 'auto',
  alibaba: {
    model: 'qwen-tts',
    voice: 'Cherry',
  },
  openai: {
    model: 'tts-1',
    voice: 'alloy',
  },
};