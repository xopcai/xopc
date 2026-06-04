import { describe, expect, it } from 'vitest';

import { TTSConfigSchema } from '../../../config/schema.js';

describe('TTSConfigSchema', () => {
  it('accepts extension provider ids and providers map', () => {
    const parsed = TTSConfigSchema.parse({
      enabled: true,
      provider: 'tts-local-cli',
      providers: {
        'tts-local-cli': {
          command: 'piper --text {{Text}}',
          outputFormat: 'wav',
        },
        openai: {
          apiKey: 'sk-test',
          model: 'tts-1',
        },
      },
    });

    expect(parsed.provider).toBe('tts-local-cli');
    expect(parsed.providers?.['tts-local-cli']?.command).toBe('piper --text {{Text}}');
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
        order: ['tts-local-cli', 'openai'],
      },
    });

    expect(parsed.fallback?.order).toEqual(['tts-local-cli', 'openai']);
  });
});
