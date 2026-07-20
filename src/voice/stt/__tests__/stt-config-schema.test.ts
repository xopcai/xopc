import { describe, expect, it } from 'vitest';

import { STTConfigSchema } from '../../../config/schema.js';

describe('STTConfigSchema', () => {
  it('defaults to local transcription without an implicit cloud fallback', () => {
    const parsed = STTConfigSchema.parse({});

    expect(parsed.enabled).toBe(true);
    expect(parsed.provider).toBe('xopc-local');
    expect(parsed.fallback).toEqual({ enabled: false, order: ['xopc-local'] });
  });

  it('accepts open provider ids and providers map', () => {
    const parsed = STTConfigSchema.parse({
      enabled: true,
      provider: 'openai',
      providers: {
        openai: { apiKey: 'sk-test', model: 'whisper-1' },
      },
    });

    expect(parsed.provider).toBe('openai');
    expect(parsed.providers?.openai?.model).toBe('whisper-1');
  });

  it('accepts models[] entries', () => {
    const parsed = STTConfigSchema.parse({
      enabled: true,
      models: [{ provider: 'openai', model: 'whisper-1', capabilities: ['audio'] }],
    });

    expect(parsed.models?.[0]?.provider).toBe('openai');
  });

  it('rejects legacy flat provider keys (must live under providers.<id>)', () => {
    expect(() =>
      STTConfigSchema.parse({
        enabled: true,
        provider: 'alibaba',
        alibaba: { model: 'paraformer-v2' },
      }),
    ).toThrow();
  });

  it('accepts open fallback order entries', () => {
    const parsed = STTConfigSchema.parse({
      fallback: {
        enabled: true,
        order: ['openai', 'alibaba', 'custom-stt'],
      },
    });

    expect(parsed.fallback?.order).toEqual(['openai', 'alibaba', 'custom-stt']);
  });
});
