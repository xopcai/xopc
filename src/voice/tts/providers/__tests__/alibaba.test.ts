import { describe, it, expect } from 'vitest';
import { AlibabaProvider } from '../alibaba.js';

describe('AlibabaProvider', () => {
  describe('getMaxTextLength', () => {
    it('should return 512 characters (Alibaba TTS API limit)', () => {
      const provider = new AlibabaProvider({
        apiKey: 'test-key',
      });

      expect(provider.getMaxTextLength()).toBe(512);
    });
  });

  describe('isConfigured', () => {
    it('should return true when API key is provided', () => {
      const provider = new AlibabaProvider({
        apiKey: 'test-key',
      });

      expect(provider.isConfigured()).toBe(true);
    });

    it('should return false when API key is missing', () => {
      const provider = new AlibabaProvider({
        apiKey: '',
      });

      expect(provider.isConfigured()).toBe(false);
    });
  });
});
