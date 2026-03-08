/**
 * Alibaba CosyVoice TTS Provider
 */

import type { TTSProvider, TTSResult, TTSOptions } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS:Alibaba');

export interface AlibabaTTSConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

interface CosyVoiceResponse {
  output: {
    speech_url?: string;
    speech?: string; // base64 encoded
    audio?: {
      data?: string;
      url?: string;
      id?: string;
      expires_at?: number;
    };
    finish_reason?: string;
  };
  usage: {
    characters: number;
  };
  request_id: string;
}

export class AlibabaProvider implements TTSProvider {
  name = 'alibaba';
  private apiKey: string;
  private model: string;
  private voice: string;
  private baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

  constructor(config: AlibabaTTSConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'qwen3-tts-flash';
    this.voice = config.voice || 'Cherry';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async speak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const startTime = Date.now();

    // Limit text length (safety limit)
    const limitedText = text.slice(0, 4000);

    try {
      log.debug({ model: this.model, voice: options?.voice || this.voice, textLength: limitedText.length }, 'Calling Alibaba TTS');

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-DataInspection': 'disable',
        },
        body: JSON.stringify({
          model: this.model,
          input: {
            text: limitedText,
            voice: options?.voice || this.voice,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Alibaba TTS error: ${response.status} ${error}`);
      }

      const data = await response.json() as CosyVoiceResponse;

      // Get audio from response
      let audioBuffer: Buffer;
      if (data.output.audio?.url) {
        // Fetch from URL if provided
        const audioResponse = await fetch(data.output.audio.url);
        audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      } else if (data.output.speech) {
        audioBuffer = Buffer.from(data.output.speech, 'base64');
      } else if (data.output.speech_url) {
        // Fetch from URL if provided
        const audioResponse = await fetch(data.output.speech_url);
        audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      } else {
        throw new Error('No audio returned from Alibaba TTS');
      }

      const duration = (Date.now() - startTime) / 1000;

      log.info({ provider: 'alibaba', format: 'wav', size: audioBuffer.length, duration, characters: data.usage?.characters }, 'TTS generated');

      return {
        audio: audioBuffer,
        format: 'wav',
        duration,
        provider: 'alibaba',
      };
    } catch (error) {
      log.error({ error, textLength: limitedText.length }, 'Alibaba TTS failed');
      throw error;
    }
  }
}