import { describe, expect, it } from 'vitest';

import {
  MAX_CHAT_INLINE_TEXT_BYTES,
  validateWebchatContent,
} from '../chat-limits.js';

describe('webchat content limits', () => {
  it('accepts inline content at the byte limit', () => {
    expect(validateWebchatContent('a'.repeat(MAX_CHAT_INLINE_TEXT_BYTES))).toBeNull();
  });

  it('rejects inline content over the byte limit', () => {
    expect(validateWebchatContent('a'.repeat(MAX_CHAT_INLINE_TEXT_BYTES + 1))).toContain(
      'exceeds maximum size',
    );
  });

  it('measures UTF-8 bytes instead of JavaScript code units', () => {
    const content = '你'.repeat(Math.floor(MAX_CHAT_INLINE_TEXT_BYTES / 3) + 1);

    expect(validateWebchatContent(content)).toContain('exceeds maximum size');
  });

  it('rejects non-string content', () => {
    expect(validateWebchatContent({})).toBe('Message content must be a string');
  });
});
