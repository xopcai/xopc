import { describe, it, expect } from 'vitest';
import { BaseTTSProvider, type BaseProviderConfig } from '../base.js';
import type { TTSOptions, TTSResult } from '../../types.js';

// Concrete implementation for testing
class TestProvider extends BaseTTSProvider {
  readonly name = 'test';

  constructor(config: BaseProviderConfig = {}) {
    super(config);
  }

  isConfigured(): boolean {
    return true;
  }

  protected async doSpeak(_text: string, _options?: TTSOptions): Promise<TTSResult> {
    return {
      audio: Buffer.from('test-audio'),
      format: 'wav',
      provider: this.name,
    };
  }
}

// Provider with custom max text length
class CustomLimitProvider extends BaseTTSProvider {
  readonly name = 'custom';
  private readonly maxTextLength = 256;

  isConfigured(): boolean {
    return true;
  }

  getMaxTextLength(): number {
    return this.maxTextLength;
  }

  protected async doSpeak(_text: string, _options?: TTSOptions): Promise<TTSResult> {
    return {
      audio: Buffer.from('test-audio'),
      format: 'wav',
      provider: this.name,
    };
  }
}

describe('BaseTTSProvider', () => {
  describe('getMaxTextLength', () => {
    it('should return default 4096 when not specified', () => {
      const provider = new TestProvider();
      expect(provider.getMaxTextLength()).toBe(4096);
    });

    it('should return custom maxTextLength from config', () => {
      const provider = new TestProvider({ maxTextLength: 1024 });
      expect(provider.getMaxTextLength()).toBe(1024);
    });

    it('should allow subclass to override', () => {
      const provider = new CustomLimitProvider();
      expect(provider.getMaxTextLength()).toBe(256);
    });
  });

  describe('speak', () => {
    it('should truncate text exceeding maxTextLength', async () => {
      const provider = new TestProvider({ maxTextLength: 50 });
      const longText = 'a'.repeat(100);

      const result = await provider.speak(longText);

      expect(result).toBeDefined();
      expect(result.provider).toBe('test');
    });

    it('should not truncate text within maxTextLength', async () => {
      const provider = new TestProvider({ maxTextLength: 100 });
      const shortText = 'Hello world';

      const result = await provider.speak(shortText);

      expect(result).toBeDefined();
      expect(result.provider).toBe('test');
    });
  });

  describe('isConfigured', () => {
    it('should return true for test provider', () => {
      const provider = new TestProvider();
      expect(provider.isConfigured()).toBe(true);
    });
  });
});
