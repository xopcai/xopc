import { redactSensitive, redactText } from '@agent-evals/protocol';
import { describe, expect, it } from 'vitest';

describe('trace redaction', () => {
  it('redacts credentials without hiding token metrics', () => {
    expect(redactSensitive({
      token: 'secret-token',
      apiKey: 'secret-key',
      maxTokens: 1000,
      usage: { totalTokens: 42 },
    })).toEqual({
      token: '[REDACTED]',
      apiKey: '[REDACTED]',
      maxTokens: 1000,
      usage: { totalTokens: 42 },
    });
    expect(redactText('Authorization: Bearer abc.def.ghi')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });
});
