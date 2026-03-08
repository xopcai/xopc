import type { TTSProviderInterface, TTSOptions, TTSResult } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TTS:Base');

export interface BaseProviderConfig {
  timeoutMs?: number;
  maxTextLength?: number;
}

export abstract class BaseTTSProvider implements TTSProviderInterface {
  abstract readonly name: string;

  protected config: BaseProviderConfig;
  protected abortController?: AbortController;

  constructor(config: BaseProviderConfig = {}) {
    this.config = {
      timeoutMs: 30000,
      maxTextLength: 4096,
      ...config,
    };
  }

  abstract isConfigured(): boolean;

  protected abstract doSpeak(text: string, options?: TTSOptions): Promise<TTSResult>;

  async speak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const startTime = Date.now();

    const maxLength = this.config.maxTextLength || 4096;
    if (text.length > maxLength) {
      log.warn({ textLength: text.length, maxLength }, 'Text too long, truncating');
      text = text.slice(0, maxLength - 3) + '...';
    }

    if (!this.isConfigured()) {
      throw new Error(`${this.name} provider is not configured`);
    }

    this.abortController = new AbortController();
    const timeoutMs = options?.timeoutMs || this.config.timeoutMs || 30000;
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
      log.warn({ provider: this.name, timeoutMs }, 'TTS request timed out');
    }, timeoutMs);

    try {
      log.debug({ provider: this.name, textLength: text.length, timeoutMs }, 'Starting TTS');

      const result = await this.doSpeak(text, options);

      const duration = (Date.now() - startTime) / 1000;
      log.info({ provider: this.name, format: result.format, size: result.audio.length, duration }, 'TTS completed');

      return {
        ...result,
        duration: result.duration || duration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error({ provider: this.name, error: errorMsg, textLength: text.length }, 'TTS failed');
      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.abortController = undefined;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      log.debug({ provider: this.name }, 'TTS aborted');
    }
  }

  protected get signal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }
}
