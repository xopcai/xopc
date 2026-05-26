import { describe, expect, it } from 'vitest';

import {
  maskSttConfigForWeb,
  maskTtsConfigForWeb,
  mergeSttConfigPatch,
  mergeTtsConfigPatch,
} from '../safe-voice-config.js';

describe('safe-voice-config', () => {
  it('masks STT api keys for web GET', () => {
    const masked = maskSttConfigForWeb({
      enabled: true,
      provider: 'groq',
      providers: { groq: { apiKey: 'gsk-secret', model: 'whisper-large-v3-turbo' } },
      openai: { apiKey: 'sk-openai' },
    }) as Record<string, unknown>;

    expect((masked.providers as Record<string, { apiKey: string }>).groq.apiKey).toBe('***');
    expect((masked.openai as { apiKey: string }).apiKey).toBe('***');
  });

  it('preserves STT api keys when patch sends masked sentinel', () => {
    const merged = mergeSttConfigPatch(
      { providers: { groq: { apiKey: 'gsk-secret', model: 'whisper-large-v3-turbo' } } },
      { providers: { groq: { apiKey: '***', model: 'whisper-large-v3' } } },
    ) as Record<string, Record<string, { apiKey: string; model: string }>>;

    expect(merged.providers.groq.apiKey).toBe('gsk-secret');
    expect(merged.providers.groq.model).toBe('whisper-large-v3');
  });

  it('masks TTS api keys for web GET', () => {
    const masked = maskTtsConfigForWeb({
      enabled: true,
      provider: 'openai',
      openai: { apiKey: 'sk-test', model: 'tts-1', voice: 'alloy' },
    }) as Record<string, unknown>;

    expect((masked.openai as { apiKey: string }).apiKey).toBe('***');
  });

  it('preserves TTS api keys when patch sends masked sentinel', () => {
    const merged = mergeTtsConfigPatch(
      { openai: { apiKey: 'sk-secret', model: 'tts-1', voice: 'alloy' } },
      { openai: { apiKey: '***', model: 'tts-1-hd', voice: 'echo' } },
    ) as { openai: { apiKey: string; model: string; voice: string } };

    expect(merged.openai.apiKey).toBe('sk-secret');
    expect(merged.openai.model).toBe('tts-1-hd');
    expect(merged.openai.voice).toBe('echo');
  });
});
