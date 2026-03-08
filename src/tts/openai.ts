/**
 * OpenAI TTS Provider
 */

import type { TTSProvider, TTSResult, TTSOptions } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS:OpenAI');

export interface OpenAITTSConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

export class OpenAIProvider implements TTSProvider {
  name = 'openai';
  private apiKey: string;
  private model: string;
  private voice: string;

  constructor(config: OpenAITTSConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'tts-1';
    this.voice = config.voice || 'alloy';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async speak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const startTime = Date.now();
    
    // Limit text length (OpenAI has 4096 char limit)
    const limitedText = text.slice(0, 4000);
    
    try {
      log.debug({ model: this.model, voice: options?.voice || this.voice, textLength: limitedText.length }, 'Calling OpenAI TTS');

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: limitedText,
          voice: options?.voice || this.voice,
          response_format: 'opus',  // Request opus format directly for Telegram
          speed: options?.speed || 1.0,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI TTS error: ${response.status} ${error}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const duration = (Date.now() - startTime) / 1000;
      
      log.info({ provider: 'openai', format: 'opus', size: buffer.length, duration }, 'TTS generated');

      return {
        audio: buffer,
        format: 'opus',
        duration,
        provider: 'openai',
      };
    } catch (error) {
      log.error({ error, textLength: limitedText.length }, 'OpenAI TTS failed');
      throw error;
    }
  }
}