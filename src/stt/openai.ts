/**
 * OpenAI Whisper STT Provider
 */

import OpenAI from 'openai';
import type { STTProvider, STTResult, STTOptions } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('STT:OpenAI');

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

export class OpenAIProvider implements STTProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'whisper-1';
  }

  isConfigured(): boolean {
    return !!this.client.apiKey;
  }

  async transcribe(audioBuffer: Buffer, options?: STTOptions): Promise<STTResult> {
    const startTime = Date.now();
    
    try {
      // Telegram voice messages are OGG, convert to WAV for better compatibility
      // OpenAI Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, webm
      // OGG is not directly supported, so we need to convert or use webm container
      
      log.debug({ 
        model: this.model, 
        bufferSize: audioBuffer.length,
        language: options?.language 
      }, 'Sending to OpenAI Whisper');

      // Create a Blob from the buffer (works in Node.js 20+)
      // Convert Buffer to Uint8Array for Blob compatibility
      const uint8Array = new Uint8Array(audioBuffer.buffer as ArrayBuffer, audioBuffer.byteOffset, audioBuffer.byteLength);
      const blob = new Blob([uint8Array], { type: 'audio/ogg' });
      
      const result = await this.client.audio.transcriptions.create({
        file: blob,
        model: this.model,
        language: options?.language,
        response_format: 'json',
      });

      const duration = (Date.now() - startTime) / 1000;
      
      log.info({ 
        provider: 'openai',
        duration,
        textLength: result.text?.length 
      }, 'Transcription completed');

      return {
        text: result.text || '',
        provider: 'openai',
        duration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? `${error.message} (${error.stack})` : String(error);
      log.error({ 
        error: errorMsg,
        bufferSize: audioBuffer.length,
        model: this.model 
      }, 'OpenAI transcription failed');
      throw new Error(`OpenAI STT failed: ${errorMsg}`);
    }
  }
}