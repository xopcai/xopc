import { describe, expect, it } from 'vitest';

import { isContextOverflowError } from '../context-overflow.js';

describe('isContextOverflowError', () => {
  it.each([
    'maximum context length exceeded',
    'context_window_exceeded: prompt is too long',
    'Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.',
    'Input tokens exceed context length',
    'Your input exceeded the context window',
    'Too many tokens in request',
    'Please reduce the length of the messages',
  ])('recognizes provider context failures: %s', (message) => {
    expect(isContextOverflowError(message)).toBe(true);
  });

  it.each([
    '401 invalid api key',
    'Your request exceeds the rate limit',
    'Your input exceeds the maximum upload size',
  ])('does not classify ordinary provider failures as overflow: %s', (message) => {
    expect(isContextOverflowError(message)).toBe(false);
  });
});
