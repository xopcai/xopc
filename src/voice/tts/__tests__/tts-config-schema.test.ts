import { describe, expect, it } from 'vitest';

import { TTSConfigSchema } from '../../../config/schema.js';

describe('TTSConfigSchema', () => {
  it('defaults automatic voice replies to off with the shared 60 second timeout', () => {
    const parsed = TTSConfigSchema.parse({});

    expect(parsed.enabled).toBe(true);
    expect(parsed.trigger).toBe('off');
    expect(parsed.timeoutMs).toBe(60_000);
  });

  it('accepts extension provider ids and providers map', () => {
    const parsed = TTSConfigSchema.parse({
      enabled: true,
      provider: 'sample-speech',
      providers: {
        'sample-speech': {
          endpoint: 'https://speech.example.test',
          outputFormat: 'mp3',
        },
        openai: {
          apiKey: 'sk-test',
          model: 'tts-1',
        },
      },
    });

    expect(parsed.provider).toBe('sample-speech');
    expect(parsed.providers?.['sample-speech']?.endpoint).toBe('https://speech.example.test');
  });

  it('rejects legacy flat provider keys (must live under providers.<id>)', () => {
    expect(() =>
      TTSConfigSchema.parse({
        enabled: true,
        provider: 'openai',
        openai: { model: 'tts-1', voice: 'alloy' },
      }),
    ).toThrow();
  });

  it('accepts open fallback order entries', () => {
    const parsed = TTSConfigSchema.parse({
      fallback: {
        enabled: true,
        order: ['sample-speech', 'openai'],
      },
    });

    expect(parsed.fallback?.order).toEqual(['sample-speech', 'openai']);
  });
});
