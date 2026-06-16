import { describe, expect, it } from 'vitest';

import {
  shouldReplaceOptimisticUserRow,
  userMessageFromSsePayload,
  userMessagesEquivalent,
} from '@/features/chat/messages/user-message-from-sse';
import type { Message } from '@/features/chat/messages/messages.types';
import { stripMediaAttachedClaimCheck } from '@/features/chat/messages/wire-text-scrub';

describe('stripMediaAttachedClaimCheck', () => {
  it('removes media claim-check lines from persisted user text', () => {
    const raw =
      'hello\n[media attached: media://inbound/a.png (image/png)]\n[media attached: media://inbound/b.png (image/png, 42 bytes)]';
    expect(stripMediaAttachedClaimCheck(raw)).toBe('hello');
  });
});

describe('userMessageFromSsePayload', () => {
  it('parses content blocks and strips media claim-check', () => {
    const msg = userMessageFromSsePayload({
      timestamp: 42,
      content:
        'caption\n[media attached: media://inbound/x.png (image/png)]',
      media: [{ uri: 'media://inbound/x.png', type: 'photo', mimeType: 'image/png', name: 'x.png' }],
    });
    expect(msg?.role).toBe('user');
    expect(msg?.timestamp).toBe(42);
    expect(msg?.content[0]).toEqual({ type: 'text', text: 'caption' });
    expect(msg?.attachments?.[0]?.uri).toBe('media://inbound/x.png');
  });

  it('parses user_transcript text shortcut', () => {
    const msg = userMessageFromSsePayload({ text: 'voice line', timestamp: 9 });
    expect(msg?.content[0]).toEqual({ type: 'text', text: 'voice line' });
  });
});

describe('shouldReplaceOptimisticUserRow', () => {
  it('replaces optimistic send when server adds media metadata', () => {
    const optimistic: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'see images' }],
      attachments: [{ type: 'image', name: 'a.png', mimeType: 'image/png', content: 'abc' }],
      timestamp: 1000,
    };
    const server: Message = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'see images\n[media attached: media://inbound/a.png (image/png)]',
        },
      ],
      attachments: [{ type: 'image', name: 'a.png', mimeType: 'image/png', uri: 'media://inbound/a.png' }],
      timestamp: 1005,
    };
    expect(shouldReplaceOptimisticUserRow(optimistic, server)).toBe(true);
  });
});

describe('userMessagesEquivalent', () => {
  it('matches by timestamp', () => {
    const a: Message = { role: 'user', content: [{ type: 'text', text: 'x' }], timestamp: 1 };
    const b: Message = { role: 'user', content: [{ type: 'text', text: 'y' }], timestamp: 1 };
    expect(userMessagesEquivalent(a, b)).toBe(true);
  });
});
