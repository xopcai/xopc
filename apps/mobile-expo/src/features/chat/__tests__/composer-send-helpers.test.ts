import { describe, expect, it } from 'vitest';

import {
  extractUserMessageText,
  mergeOptimisticUserMessages,
} from '../composer-send-helpers';
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

describe('mergeOptimisticUserMessages', () => {
  const textMessage = (
    id: string,
    text: string,
    timestamp: number,
    role: Message['role'] = 'user',
  ): Message => ({
    id,
    role,
    content: [{ type: 'text', text }],
    timestamp,
  });

  it('uses the durable transcript row when it matches the optimistic tail', () => {
    const server = textMessage('row-1', 'plan a study session', 10_010);
    const optimistic = textMessage('optimistic-1', 'plan a study session', 10_000);

    expect(mergeOptimisticUserMessages([server], [optimistic])).toEqual([server]);
  });

  it('matches a server transcript that expands the optimistic display text', () => {
    const server: Message = {
      ...textMessage('row-1', 'inspect this image\n\n[media attached]', 10_010, 'user-with-attachments'),
      attachments: [{ id: 'server-image', type: 'image' }],
    };
    const optimistic: Message = {
      ...textMessage('optimistic-1', 'inspect this image', 10_000, 'user-with-attachments'),
      attachments: [{ id: 'local-image', type: 'image' }],
    };

    expect(mergeOptimisticUserMessages([server], [optimistic])).toEqual([server]);
  });

  it('keeps an intentionally repeated prompt after a completed assistant turn', () => {
    const previous = textMessage('row-1', 'try again', 10_000);
    const assistant: Message = {
      id: 'row-2',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done.' }],
      timestamp: 10_100,
    };
    const repeated = textMessage('optimistic-1', 'try again', 10_200);

    expect(mergeOptimisticUserMessages([previous, assistant], [repeated])).toEqual([
      previous,
      assistant,
      repeated,
    ]);
  });

  it('does not reconcile an old same-text user tail', () => {
    const previous = textMessage('row-1', 'try again', 10_000);
    const repeated = textMessage('optimistic-1', 'try again', 200_001);

    expect(mergeOptimisticUserMessages([previous], [repeated])).toEqual([previous, repeated]);
  });
});
