import { describe, it, expect } from 'vitest';
import {
  parseTtsDirectives,
  hasTtsDirectives,
  stripTtsDirectives,
  buildTtsSystemPromptHint,
} from '../directives.js';

describe('TTS Directives', () => {
  describe('parseTtsDirectives', () => {
    it('parses provider override', () => {
      const result = parseTtsDirectives('Hello [[tts:provider=openai]] world', {
        enabled: true,
        allowProvider: true,
      });

      expect(result.cleanedText).toBe('Hello world');
      expect(result.overrides.provider).toBe('openai');
      expect(result.hasDirective).toBe(true);
    });

    it('parses voice override', () => {
      const result = parseTtsDirectives('Hello [[tts:voice=alloy]] world', {
        enabled: true,
        allowVoice: true,
      });

      expect(result.cleanedText).toBe('Hello world');
      expect(result.overrides.openai?.voice).toBe('alloy');
    });

    it('parses model override', () => {
      const result = parseTtsDirectives('Hello [[tts:model=tts-1-hd]] world', {
        enabled: true,
        allowModelId: true,
      });

      expect(result.cleanedText).toBe('Hello world');
      expect(result.overrides.openai?.model).toBe('tts-1-hd');
    });

    it('parses tts:text block', () => {
      const result = parseTtsDirectives(
        'Display text [[tts:text]]Custom speech text[[/tts:text]]',
        { enabled: true, allowText: true }
      );

      expect(result.cleanedText).toBe('Display text');
      expect(result.ttsText).toBe('Custom speech text');
    });

    it('parses multiple directives', () => {
      const result = parseTtsDirectives(
        'Hello [[tts:provider=openai voice=echo model=tts-1]] world',
        {
          enabled: true,
          allowProvider: true,
          allowVoice: true,
          allowModelId: true,
        }
      );

      expect(result.cleanedText).toBe('Hello world');
      expect(result.overrides.provider).toBe('openai');
      expect(result.overrides.openai?.voice).toBe('echo');
      expect(result.overrides.openai?.model).toBe('tts-1');
    });

    it('rejects provider override when not allowed', () => {
      const result = parseTtsDirectives('Hello [[tts:provider=openai]] world', {
        enabled: true,
        allowProvider: false,
      });

      expect(result.overrides.provider).toBeUndefined();
    });

    it('rejects invalid provider', () => {
      const result = parseTtsDirectives('Hello [[tts:provider=invalid]] world', {
        enabled: true,
        allowProvider: true,
      });

      expect(result.overrides.provider).toBeUndefined();
      expect(result.warnings).toContain('Invalid provider "invalid"');
    });

    it('returns text unchanged when disabled', () => {
      const input = 'Hello [[tts:voice=alloy]] world';
      const result = parseTtsDirectives(input, { enabled: false });

      expect(result.cleanedText).toBe(input);
      expect(result.hasDirective).toBe(false);
    });

    it('parses Alibaba-specific directives', () => {
      const result = parseTtsDirectives(
        'Hello [[tts:alibaba_voice=Cherry alibaba_model=qwen-tts]]',
        {
          enabled: true,
          allowVoice: true,
          allowModelId: true,
        }
      );

      expect(result.overrides.alibaba?.voice).toBe('Cherry');
      expect(result.overrides.alibaba?.model).toBe('qwen-tts');
    });

    it('parses Edge-specific directives', () => {
      const result = parseTtsDirectives(
        'Hello [[tts:edge_voice=en-US-MichelleNeural]]',
        {
          enabled: true,
          allowVoice: true,
        }
      );

      expect(result.overrides.edge?.voice).toBe('en-US-MichelleNeural');
    });
  });

  describe('hasTtsDirectives', () => {
    it('detects directives', () => {
      expect(hasTtsDirectives('Hello [[tts:voice=alloy]]')).toBe(true);
      expect(hasTtsDirectives('Hello [[tts:text]]test[[/tts:text]]')).toBe(true);
    });

    it('returns false for no directives', () => {
      expect(hasTtsDirectives('Hello world')).toBe(false);
      expect(hasTtsDirectives('[[other:directive]]')).toBe(false);
    });
  });

  describe('stripTtsDirectives', () => {
    it('removes all directives', () => {
      const result = stripTtsDirectives('Hello [[tts:voice=alloy]] world [[tts:text]]test[[/tts:text]]');
      expect(result).toBe('Hello world');
    });

    it('handles text without directives', () => {
      const input = 'Hello world';
      expect(stripTtsDirectives(input)).toBe(input);
    });
  });

  describe('buildTtsSystemPromptHint', () => {
    it('returns undefined when disabled', () => {
      const result = buildTtsSystemPromptHint({ enabled: false, trigger: 'off' });
      expect(result).toBeUndefined();
    });

    it('returns undefined for off trigger', () => {
      const result = buildTtsSystemPromptHint({ enabled: true, trigger: 'off' });
      expect(result).toBeUndefined();
    });

    it('includes trigger hints', () => {
      const result = buildTtsSystemPromptHint({ enabled: true, trigger: 'inbound' });
      expect(result).toContain("user's last message includes audio/voice");
    });

    it('includes directive hints', () => {
      const result = buildTtsSystemPromptHint({
        enabled: true,
        trigger: 'tagged',
        modelOverrides: {
          enabled: true,
          allowText: true,
          allowVoice: true,
        },
      });
      expect(result).toContain('[[tts:text]]');
      expect(result).toContain('[[tts:voice=...]]');
    });

    it('includes max length hint', () => {
      const result = buildTtsSystemPromptHint({
        enabled: true,
        trigger: 'always',
        maxTextLength: 2000,
      });
      expect(result).toContain('≤2000');
    });
  });
});
