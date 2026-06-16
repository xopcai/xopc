import { describe, expect, it } from 'vitest';

import { sanitizeForPromptLiteral } from '../sanitize-for-prompt.js';

describe('sanitizeForPromptLiteral', () => {
  it('strips control and format characters', () => {
    expect(sanitizeForPromptLiteral('hello\nworld\u2028')).toBe('helloworld');
    expect(sanitizeForPromptLiteral('path/with\rcrlf')).toBe('path/withcrlf');
  });

  it('preserves normal path characters', () => {
    expect(sanitizeForPromptLiteral('/Users/me/.xopc/workspace')).toBe(
      '/Users/me/.xopc/workspace',
    );
  });
});
