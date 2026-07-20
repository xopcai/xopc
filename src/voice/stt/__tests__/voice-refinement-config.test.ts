import { describe, expect, it } from 'vitest';

import { ConfigSchema, VoiceConfigSchema } from '../../../config/schema.js';

describe('VoiceConfigSchema', () => {
  it('keeps transcript refinement off by default', () => {
    const parsed = VoiceConfigSchema.parse({ input: { refinement: {} } });

    expect(parsed?.input?.refinement?.mode).toBe('off');
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
