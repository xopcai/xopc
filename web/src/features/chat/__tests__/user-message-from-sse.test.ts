import { describe, expect, it } from 'vitest';

import {
  shouldReplaceOptimisticUserRow,
  userMessageFromSsePayload,
  userMessagesEquivalent,
} from '@/features/chat/messages/user-message-from-sse';
import type { Message } from '@/features/chat/messages/messages.types';
import {
  stripImageUnderstandingContext,
  stripMediaAttachedClaimCheck,
} from '@/features/chat/messages/wire-text-scrub';

describe('stripMediaAttachedClaimCheck', () => {
  it('removes media claim-check lines from persisted user text', () => {
    const raw =
      'hello\n[media attached: media://inbound/a.png (image/png)]\n[media attached: media://inbound/b.png (image/png, 42 bytes)]';
    expect(stripMediaAttachedClaimCheck(raw)).toBe('hello');
  });
});

describe('stripImageUnderstandingContext', () => {
  it('removes generated image descriptions from visible user text', () => {
    const raw = '看看这张图\n\n[Image description: A detailed\nmultiline description.]';
    expect(stripImageUnderstandingContext(raw)).toBe('看看这张图');
  });

  it('removes image-understanding failures from visible user text', () => {
    const raw =
      '[1 image(s) attached but could not be described: Image model failed: invalid api key]';
    expect(stripImageUnderstandingContext(raw)).toBe('');
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

  it('keeps image media and hides generated understanding context', () => {
    const msg = userMessageFromSsePayload({
      timestamp: 42,
      content: '[Image description: A blue interface.]',
      attachments: [
        {
          uri: 'media://inbound/x.png',
          type: 'photo',
          mimeType: 'image/png',
          name: 'x.png',
        },
      ],
    });

    expect(msg?.content).toEqual([]);
    expect(msg?.attachments).toEqual([
      expect.objectContaining({
        uri: 'media://inbound/x.png',
        type: 'image',
        mimeType: 'image/png',
      }),
    ]);
  });
});

describe('shouldReplaceOptimisticUserRow', () => {
  it('replaces a multiline skill draft with its expanded server row', () => {
    const text = `/skill:build-xopc-local-app 请修复当前草稿。

- Add a book: Visible text was not found`;
    const optimistic: Message = {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: 1000,
    };
    const server = userMessageFromSsePayload({
      timestamp: 1005,
      content: `## Skill: build-xopc-local-app

Build a local XOPC app.

**Arguments**: 请修复当前草稿。

- Add a book: Visible text was not found`,
    });

    expect(server?.content[0]).toEqual({ type: 'text', text });
    expect(server && shouldReplaceOptimisticUserRow(optimistic, server)).toBe(true);
  });

  it('keeps optimistic attachments when an early server row has only matching text', () => {
    const optimistic: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'see image' }],
      attachments: [{ type: 'image', name: 'a.png', mimeType: 'image/png', data: 'abc' }],
      timestamp: 1000,
    };
    const server: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'see image' }],
      timestamp: 1005,
    };
    expect(shouldReplaceOptimisticUserRow(optimistic, server)).toBe(false);
  });

  it('keeps all optimistic attachments until the server row has all media metadata', () => {
    const optimistic: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'see images' }],
      attachments: [
        { type: 'image', name: 'a.png', mimeType: 'image/png', data: 'a' },
        { type: 'image', name: 'b.png', mimeType: 'image/png', data: 'b' },
      ],
      timestamp: 1000,
    };
    const partialServer: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'see images' }],
      attachments: [{ type: 'image', name: 'a.png', mimeType: 'image/png', uri: 'media://inbound/a.png' }],
      timestamp: 1005,
    };
    expect(shouldReplaceOptimisticUserRow(optimistic, partialServer)).toBe(false);
  });

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
