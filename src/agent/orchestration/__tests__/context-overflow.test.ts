import { describe, expect, it } from 'vitest';

import { isContextOverflowError } from '../context-overflow.js';

describe('isContextOverflowError', () => {
  it.each([
    'maximum context length exceeded',
    'context_window_exceeded: prompt is too long',
    'Too many tokens in request',
    'Please reduce the length of the messages',
  ])('recognizes provider context failures: %s', (message) => {
    expect(isContextOverflowError(message)).toBe(true);
  });

  it('does not classify ordinary provider failures as overflow', () => {
    expect(isContextOverflowError('401 invalid api key')).toBe(false);
  });
});
