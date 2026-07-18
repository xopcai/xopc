import { describe, expect, it } from 'vitest';

import { messageKey } from '../message-key';
import type { Message } from '../messages.types';

describe('messageKey', () => {
  it('keeps a server-backed message key stable when earlier history is prepended', () => {
    const message: Message = { id: 'msg-42', role: 'assistant', content: [], timestamp: 42 };

    expect(messageKey(message, 1)).toBe('msg-42');
    expect(messageKey(message, 101)).toBe('msg-42');
  });

  it('uses the stable timestamp fallback before the positional fallback', () => {
    const message: Message = { role: 'user', content: [], timestamp: 42 };

    expect(messageKey(message, 1)).toBe('user-42');
    expect(messageKey(message, 101)).toBe('user-42');
  });
});
