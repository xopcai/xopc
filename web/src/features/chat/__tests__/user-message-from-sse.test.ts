import { describe, expect, it } from 'vitest';

import {
  userMessageFromSsePayload,
  userMessagesEquivalent,
} from '@/features/chat/messages/user-message-from-sse';
import type { Message } from '@/features/chat/messages/messages.types';

describe('userMessageFromSsePayload', () => {
  it('parses content blocks', () => {
    const msg = userMessageFromSsePayload({
      timestamp: 42,
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(msg?.role).toBe('user');
    expect(msg?.timestamp).toBe(42);
    expect(msg?.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('parses user_transcript text shortcut', () => {
    const msg = userMessageFromSsePayload({ text: 'voice line', timestamp: 9 });
    expect(msg?.content[0]).toEqual({ type: 'text', text: 'voice line' });
  });
});

describe('userMessagesEquivalent', () => {
  it('matches by timestamp', () => {
    const a: Message = { role: 'user', content: [{ type: 'text', text: 'x' }], timestamp: 1 };
    const b: Message = { role: 'user', content: [{ type: 'text', text: 'y' }], timestamp: 1 };
    expect(userMessagesEquivalent(a, b)).toBe(true);
  });
});
