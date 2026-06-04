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
      providers: {
        groq: { apiKey: 'gsk-secret', model: 'whisper-large-v3-turbo' },
        openai: { apiKey: 'sk-openai' },
      },
    }) as Record<string, Record<string, { apiKey: string }>>;

    expect(masked.providers.groq.apiKey).toBe('***');
    expect(masked.providers.openai.apiKey).toBe('***');
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
      providers: { openai: { apiKey: 'sk-test', model: 'tts-1', voice: 'alloy' } },
    }) as Record<string, Record<string, { apiKey: string }>>;

    expect(masked.providers.openai.apiKey).toBe('***');
  });

  it('preserves TTS api keys when patch sends masked sentinel', () => {
    const merged = mergeTtsConfigPatch(
      { providers: { openai: { apiKey: 'sk-secret', model: 'tts-1', voice: 'alloy' } } },
      { providers: { openai: { apiKey: '***', model: 'tts-1-hd', voice: 'echo' } } },
    ) as { providers: { openai: { apiKey: string; model: string; voice: string } } };

    expect(merged.providers.openai.apiKey).toBe('sk-secret');
    expect(merged.providers.openai.model).toBe('tts-1-hd');
    expect(merged.providers.openai.voice).toBe('echo');
  });
});
