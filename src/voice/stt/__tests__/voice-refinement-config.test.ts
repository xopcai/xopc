import { describe, expect, it } from 'vitest';

import { ConfigSchema, VoiceConfigSchema } from '../../../config/schema.js';

describe('VoiceConfigSchema', () => {
  it('keeps transcript refinement off by default', () => {
    const parsed = VoiceConfigSchema.parse({ input: { refinement: {} } });

    expect(parsed?.input?.refinement?.mode).toBe('off');
  });

  it('applies bounded realtime defaults', () => {
    const parsed = VoiceConfigSchema.parse({ realtime: {} });
    expect(parsed?.realtime).toEqual({
      enabled: false,
      silenceDurationMs: 700,
      idleTimeoutMs: 60_000,
      maxDictationMs: 600_000,
      maxConversationMs: 3_600_000,
      bargeIn: true,
    });
    expect(VoiceConfigSchema.safeParse({ realtime: { silenceDurationMs: 100 } }).success).toBe(false);
    expect(VoiceConfigSchema.safeParse({ realtime: { prefixPaddingMs: 300 } }).success).toBe(false);
  });

  it('accepts explicit punctuation and model settings in the root config', () => {
    const parsed = ConfigSchema.parse({
      voice: {
        input: {
          refinement: { mode: 'punctuation', model: 'openai/gpt-test' },
        },
      },
    });

    expect(parsed.voice?.input?.refinement).toEqual({
      mode: 'punctuation',
      model: 'openai/gpt-test',
    });
  });
});
