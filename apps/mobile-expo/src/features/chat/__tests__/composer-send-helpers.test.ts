import { describe, expect, it } from 'vitest';

import { extractUserMessageText } from '../composer-send-helpers';
import type { Message } from '../messages.types';

describe('extractUserMessageText', () => {
  it('joins text blocks and strips envelope timestamps', () => {
    const msg: Message = {
      role: 'user',
      content: [
        { type: 'text', text: '[2024-01-01 12:00 UTC] hello' },
        { type: 'text', text: 'world' },
      ],
    };
    expect(extractUserMessageText(msg.content)).toBe('hello\n\nworld');
  });
});
